/**
 * Platform-agnostic domain types. Platform adapters (e.g. src/x) map their
 * API responses into these shapes so the rest of the app never depends on
 * a specific platform's payload format.
 */

export type PlatformId = "X";

export interface PostMetrics {
  likes: number;
  replies: number;
  reposts: number;
  quotes: number;
}

export interface NormalizedAuthor {
  id: string;
  username: string;
  displayName?: string;
  followersCount?: number;
  verified?: boolean;
}

export interface NormalizedPost {
  platform: PlatformId;
  id: string;
  text: string;
  authorId: string;
  author?: NormalizedAuthor;
  lang?: string;
  conversationId?: string;
  inReplyToPostId?: string;
  createdAt: Date;
  metrics: PostMetrics;
}

export interface CreatedPost {
  id: string;
  text: string;
}
