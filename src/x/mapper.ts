import type { NormalizedAuthor, NormalizedPost } from "../types/index.js";

/** Subset of X API v2 payload shapes the bot requests. */
export interface ApiTweet {
  id: string;
  text: string;
  author_id?: string;
  created_at?: string;
  lang?: string;
  conversation_id?: string;
  public_metrics?: {
    like_count?: number;
    reply_count?: number;
    retweet_count?: number;
    quote_count?: number;
  };
  referenced_tweets?: { type: "retweeted" | "quoted" | "replied_to"; id: string }[];
}

export interface ApiUser {
  id: string;
  username: string;
  name?: string;
  verified?: boolean;
  public_metrics?: { followers_count?: number };
}

export const TWEET_FIELDS =
  "author_id,created_at,lang,conversation_id,public_metrics,referenced_tweets";
export const USER_FIELDS = "username,name,verified,public_metrics";

export function mapUser(user: ApiUser): NormalizedAuthor {
  return {
    id: user.id,
    username: user.username,
    ...(user.name !== undefined && { displayName: user.name }),
    ...(user.verified !== undefined && { verified: user.verified }),
    ...(user.public_metrics?.followers_count !== undefined && {
      followersCount: user.public_metrics.followers_count,
    }),
  };
}

export function mapTweet(tweet: ApiTweet, usersById: Map<string, ApiUser>): NormalizedPost {
  const refs = tweet.referenced_tweets ?? [];
  const repliedTo = refs.find((r) => r.type === "replied_to");
  const author = tweet.author_id ? usersById.get(tweet.author_id) : undefined;
  const metrics = tweet.public_metrics ?? {};

  return {
    platform: "X",
    id: tweet.id,
    text: tweet.text,
    authorId: tweet.author_id ?? "",
    ...(author && { author: mapUser(author) }),
    ...(tweet.lang !== undefined && { lang: tweet.lang }),
    ...(tweet.conversation_id !== undefined && { conversationId: tweet.conversation_id }),
    ...(repliedTo && { inReplyToPostId: repliedTo.id }),
    isRepost: refs.some((r) => r.type === "retweeted"),
    isQuote: refs.some((r) => r.type === "quoted"),
    createdAt: tweet.created_at ? new Date(tweet.created_at) : new Date(),
    metrics: {
      likes: metrics.like_count ?? 0,
      replies: metrics.reply_count ?? 0,
      reposts: metrics.retweet_count ?? 0,
      quotes: metrics.quote_count ?? 0,
    },
  };
}

export function indexUsers(users: ApiUser[] | undefined): Map<string, ApiUser> {
  return new Map((users ?? []).map((u) => [u.id, u]));
}
