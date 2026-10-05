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

export interface GetMentionsParams {
  /** The bot's own user ID. */
  userId: string;
  /** 5–100 per X limits. */
  maxResults?: number;
  sinceId?: string;
  startTime?: Date;
  paginationToken?: string;
}

export interface MentionsResult extends SearchPostsResult {
  /** Posts the mentions reply to or quote (thread context), keyed by ID. */
  referencedPosts: Map<string, NormalizedPost>;
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
  /** Posts that @mention the given user, newest first. */
  getMentions(params: GetMentionsParams): Promise<MentionsResult>;
  getPost(postId: string): Promise<NormalizedPost | null>;
  getUser(userId: string): Promise<NormalizedAuthor | null>;
  /** The account the credentials belong to. */
  getAuthenticatedUser(): Promise<NormalizedAuthor>;
  createPost(input: CreatePostInput): Promise<CreatedPost>;
  createReply(input: CreateReplyInput): Promise<CreatedPost>;
}
