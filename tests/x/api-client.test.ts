import { describe, expect, it, vi } from "vitest";
import { XApiClient } from "../../src/x/api-client.js";
import { DryRunXClient } from "../../src/x/dry-run-client.js";
import { XApiError, XRateLimitError } from "../../src/x/errors.js";
import type { XClient } from "../../src/x/client.js";
import { silentLogger } from "../helpers.js";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function clientWith(fetchMock: ReturnType<typeof vi.fn>) {
  return new XApiClient({
    credentials: { apiKey: "k", apiSecret: "s", accessToken: "t", accessTokenSecret: "ts" },
    logger: silentLogger,
    fetch: fetchMock as unknown as typeof fetch,
  });
}

describe("XApiClient", () => {
  it("searches recent posts and normalizes the response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        data: [
          {
            id: "100",
            text: "DeFi is evolving fast",
            author_id: "u1",
            created_at: "2026-10-05T10:00:00.000Z",
            lang: "en",
            conversation_id: "100",
            public_metrics: { like_count: 5, reply_count: 1, retweet_count: 2, quote_count: 0 },
            referenced_tweets: [{ type: "quoted", id: "99" }],
          },
        ],
        includes: { users: [{ id: "u1", username: "alice", name: "Alice" }] },
        meta: { newest_id: "100", result_count: 1 },
      }),
    );

    const result = await clientWith(fetchMock).searchPosts({
      query: "defi lang:en",
      maxResults: 10,
      sinceId: "50",
      startTime: new Date("2026-10-05T00:00:00Z"),
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    const requestUrl = new URL(url as URL);
    expect(requestUrl.pathname).toBe("/2/tweets/search/recent");
    expect(requestUrl.searchParams.get("query")).toBe("defi lang:en");
    expect(requestUrl.searchParams.get("since_id")).toBe("50");
    expect(requestUrl.searchParams.has("start_time")).toBe(false);
    expect((init as RequestInit).headers).toMatchObject({
      authorization: expect.stringMatching(/^OAuth /),
    });

    expect(result.newestId).toBe("100");
    expect(result.posts[0]).toMatchObject({
      id: "100",
      authorId: "u1",
      author: { username: "alice", displayName: "Alice" },
      isQuote: true,
      isRepost: false,
      metrics: { likes: 5, replies: 1, reposts: 2, quotes: 0 },
    });
  });

  it("fetches mentions with their thread context", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        data: [
          {
            id: "300",
            text: "@bot what do you think about this?",
            author_id: "u2",
            created_at: "2026-10-05T11:00:00.000Z",
            referenced_tweets: [{ type: "replied_to", id: "250" }],
          },
        ],
        includes: {
          users: [{ id: "u2", username: "carol" }],
          tweets: [{ id: "250", text: "Oracle lag caused the liquidation cascade", author_id: "u2" }],
        },
        meta: { newest_id: "300", next_token: "n2" },
      }),
    );

    const result = await clientWith(fetchMock).getMentions({ userId: "me", sinceId: "200", maxResults: 10 });

    const requestUrl = new URL(fetchMock.mock.calls[0]![0] as URL);
    expect(requestUrl.pathname).toBe("/2/users/me/mentions");
    expect(requestUrl.searchParams.get("since_id")).toBe("200");
    expect(requestUrl.searchParams.get("expansions")).toContain("referenced_tweets.id");
    expect(result.posts[0]).toMatchObject({ id: "300", inReplyToPostId: "250", author: { username: "carol" } });
    expect(result.referencedPosts.get("250")?.text).toBe("Oracle lag caused the liquidation cascade");
    expect(result).toMatchObject({ newestId: "300", nextToken: "n2" });
  });

  it("sends replies with the in_reply_to_tweet_id payload", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(201, { data: { id: "200", text: "Nice" } }));
    const created = await clientWith(fetchMock).createReply({
      inReplyToPostId: "100",
      text: "Nice",
    });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      text: "Nice",
      reply: { in_reply_to_tweet_id: "100" },
    });
    expect(created).toEqual({ id: "200", text: "Nice" });
  });

  it("raises XRateLimitError on 429 with the reset time", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(429, {}, { "x-rate-limit-reset": "1791200000" }));
    const error = await clientWith(fetchMock)
      .searchPosts({ query: "x" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(XRateLimitError);
    expect((error as XRateLimitError).resetAt?.getTime()).toBe(1791200000 * 1000);
  });

  it("raises a non-retryable XApiError with detail on 403", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(403, { title: "Forbidden", detail: "Not permitted" }));
    const error = await clientWith(fetchMock)
      .createPost({ text: "hi" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(XApiError);
    expect((error as XApiError).retryable).toBe(false);
    expect((error as XApiError).detail).toBe("Not permitted");
  });
});

describe("DryRunXClient", () => {
  it("never calls write methods on the real client", async () => {
    const inner = {
      createPost: vi.fn(),
      createReply: vi.fn(),
      searchPosts: vi.fn().mockResolvedValue({ posts: [] }),
    } as unknown as XClient;
    const client = new DryRunXClient(inner, silentLogger);

    const reply = await client.createReply({ inReplyToPostId: "1", text: "hello" });
    await client.createPost({ text: "post" });
    await client.searchPosts({ query: "q" });

    expect(reply.id).toMatch(/^dry-run-/);
    expect(inner.createPost).not.toHaveBeenCalled();
    expect(inner.createReply).not.toHaveBeenCalled();
    expect(inner.searchPosts).toHaveBeenCalledOnce();
  });
});
