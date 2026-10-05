import type { Logger } from "pino";
import type { CreatedPost, NormalizedAuthor, NormalizedPost } from "../types/index.js";
import type {
  CreatePostInput,
  CreateReplyInput,
  GetMentionsParams,
  MentionsResult,
  SearchPostsParams,
  SearchPostsResult,
  XClient,
} from "./client.js";
import { XApiError, XRateLimitError } from "./errors.js";
import {
  indexUsers,
  mapTweet,
  mapUser,
  TWEET_FIELDS,
  USER_FIELDS,
  type ApiTweet,
  type ApiUser,
} from "./mapper.js";
import { buildOAuth1Header, type OAuth1Credentials } from "./oauth1.js";

export interface XApiClientOptions {
  credentials: OAuth1Credentials;
  logger: Logger;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

interface ApiErrorBody {
  title?: string;
  detail?: string;
  errors?: { message?: string; detail?: string; title?: string }[];
}

type Query = Record<string, string | number | undefined>;

/** X API v2 client using OAuth 1.0a user context. */
export class XApiClient implements XClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private me?: NormalizedAuthor;

  constructor(private readonly options: XApiClientOptions) {
    this.baseUrl = options.baseUrl ?? "https://api.x.com";
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  async searchPosts(params: SearchPostsParams): Promise<SearchPostsResult> {
    const body = await this.request<{
      data?: ApiTweet[];
      includes?: { users?: ApiUser[] };
      meta?: { newest_id?: string; next_token?: string };
    }>("GET", "/2/tweets/search/recent", {
      query: params.query,
      max_results: params.maxResults,
      since_id: params.sinceId,
      start_time: params.sinceId ? undefined : params.startTime?.toISOString(),
      next_token: params.nextToken,
      "tweet.fields": TWEET_FIELDS,
      "user.fields": USER_FIELDS,
      expansions: "author_id",
    });

    const users = indexUsers(body.includes?.users);
    return {
      posts: (body.data ?? []).map((t) => mapTweet(t, users)),
      ...(body.meta?.newest_id && { newestId: body.meta.newest_id }),
      ...(body.meta?.next_token && { nextToken: body.meta.next_token }),
    };
  }

  async getMentions(params: GetMentionsParams): Promise<MentionsResult> {
    const body = await this.request<{
      data?: ApiTweet[];
      includes?: { users?: ApiUser[]; tweets?: ApiTweet[] };
      meta?: { newest_id?: string; next_token?: string };
    }>("GET", `/2/users/${encodeURIComponent(params.userId)}/mentions`, {
      max_results: params.maxResults,
      since_id: params.sinceId,
      start_time: params.sinceId ? undefined : params.startTime?.toISOString(),
      pagination_token: params.paginationToken,
      "tweet.fields": TWEET_FIELDS,
      "user.fields": USER_FIELDS,
      expansions: "author_id,referenced_tweets.id,referenced_tweets.id.author_id",
    });

    const users = indexUsers(body.includes?.users);
    return {
      posts: (body.data ?? []).map((t) => mapTweet(t, users)),
      referencedPosts: new Map((body.includes?.tweets ?? []).map((t) => [t.id, mapTweet(t, users)])),
      ...(body.meta?.newest_id && { newestId: body.meta.newest_id }),
      ...(body.meta?.next_token && { nextToken: body.meta.next_token }),
    };
  }

  async getPost(postId: string): Promise<NormalizedPost | null> {
    const body = await this.request<{ data?: ApiTweet; includes?: { users?: ApiUser[] } }>(
      "GET",
      `/2/tweets/${encodeURIComponent(postId)}`,
      { "tweet.fields": TWEET_FIELDS, "user.fields": USER_FIELDS, expansions: "author_id" },
    );
    return body.data ? mapTweet(body.data, indexUsers(body.includes?.users)) : null;
  }

  async getUser(userId: string): Promise<NormalizedAuthor | null> {
    const body = await this.request<{ data?: ApiUser }>(
      "GET",
      `/2/users/${encodeURIComponent(userId)}`,
      { "user.fields": USER_FIELDS },
    );
    return body.data ? mapUser(body.data) : null;
  }

  async getAuthenticatedUser(): Promise<NormalizedAuthor> {
    if (!this.me) {
      const body = await this.request<{ data: ApiUser }>("GET", "/2/users/me", {
        "user.fields": USER_FIELDS,
      });
      this.me = mapUser(body.data);
    }
    return this.me;
  }

  createPost(input: CreatePostInput): Promise<CreatedPost> {
    return this.postTweet({ text: input.text });
  }

  createReply(input: CreateReplyInput): Promise<CreatedPost> {
    return this.postTweet({
      text: input.text,
      reply: { in_reply_to_tweet_id: input.inReplyToPostId },
    });
  }

  private async postTweet(payload: object): Promise<CreatedPost> {
    const body = await this.request<{ data: { id: string; text: string } }>(
      "POST",
      "/2/tweets",
      undefined,
      payload,
    );
    return { id: body.data.id, text: body.data.text };
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    query?: Query,
    json?: object,
  ): Promise<T> {
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = {
      authorization: buildOAuth1Header({
        method,
        url: url.toString(),
        credentials: this.options.credentials,
      }),
    };
    if (json) headers["content-type"] = "application/json";

    const endpoint = `${method} ${path}`;
    const response = await this.fetchImpl(url, {
      method,
      headers,
      ...(json && { body: JSON.stringify(json) }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    const remaining = response.headers.get("x-rate-limit-remaining");
    const reset = response.headers.get("x-rate-limit-reset");
    const resetAt = reset ? new Date(Number(reset) * 1000) : undefined;
    this.options.logger.debug(
      { endpoint, status: response.status, rateLimitRemaining: remaining },
      "X API response",
    );

    if (response.status === 429) throw new XRateLimitError(endpoint, resetAt);

    const text = await response.text();
    let body: unknown = {};
    let unparsable = false;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        unparsable = true;
      }
    }

    if (!response.ok) {
      const error = body as ApiErrorBody;
      const detail =
        error.detail ??
        error.errors?.map((e) => e.detail ?? e.message ?? e.title).join("; ") ??
        error.title ??
        (unparsable ? text.slice(0, 200) : undefined);
      throw new XApiError(
        `X API ${endpoint} failed with ${response.status}${detail ? `: ${detail}` : ""}`,
        response.status,
        endpoint,
        detail,
      );
    }
    if (unparsable) {
      throw new XApiError(`X API ${endpoint} returned a non-JSON body`, response.status, endpoint);
    }
    return body as T;
  }
}
