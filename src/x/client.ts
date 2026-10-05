import type { CreatedPost, NormalizedAuthor, NormalizedPost } from "../types/index.js";

/**
 * Contract for the X API adapter (official X API v2 only). No browser
 * automation, scraping or session/cookie access — ever.
 */

export interface SearchPostsParams {
  /** X search query syntax, e.g. `"exact phrase" #tag -is:retweet lang:en`. */
  query: string;
  /** 10–100 per X recent search limits. */
  maxResults?: number;
  /** Only return posts newer than this ID (incremental search). */
  sinceId?: string;
  /** Only return posts created after this time. Ignored by X when sinceId is set. */
  startTime?: Date;
  /** Pagination token from a previous page. */
  nextToken?: string;
}

export interface SearchPostsResult {
  posts: NormalizedPost[];
  newestId?: string;
  nextToken?: string;
}

export interface CreatePostInput {
  text: string;
}

export interface CreateReplyInput {
  inReplyToPostId: string;
  text: string;
}

export interface XClient {
  searchPosts(params: SearchPostsParams): Promise<SearchPostsResult>;
  getPost(postId: string): Promise<NormalizedPost | null>;
  getUser(userId: string): Promise<NormalizedAuthor | null>;
  /** The account the credentials belong to. */
  getAuthenticatedUser(): Promise<NormalizedAuthor>;
  createPost(input: CreatePostInput): Promise<CreatedPost>;
  createReply(input: CreateReplyInput): Promise<CreatedPost>;
}
