import type { NormalizedPost } from "../types/index.js";
import { extractHashtags, extractMentions, matchTerms, normalizeText } from "../utils/text.js";
import type { DiscoveryContext } from "./query.js";

export interface FilterResult {
  passed: boolean;
  /** Machine-readable reasons the post was rejected, e.g. `excluded-keyword`. */
  reasons: string[];
  excludedMatches: string[];
}

export function postAgeMinutes(post: NormalizedPost, now: Date): number {
  return (now.getTime() - post.createdAt.getTime()) / 60_000;
}

/** Text length ignoring URLs, mentions and surrounding whitespace. */
function meaningfulLength(text: string): number {
  return normalizeText(text).replace(/@\w+/g, "").replace(/\s+/g, " ").trim().length;
}

/** Hard eligibility rules. A post failing any rule is never engaged with. */
export function applyFilters(post: NormalizedPost, ctx: DiscoveryContext, now: Date): FilterResult {
  const { filters, targeting, niche, search } = ctx.config;
  const reasons: string[] = [];

  if (ctx.ownUserId && post.authorId === ctx.ownUserId) reasons.push("own-post");
  if (post.isRepost) reasons.push("repost");
  if (search.excludeReplies && post.inReplyToPostId) reasons.push("reply");

  const username = post.author?.username.toLowerCase();
  if (username && targeting.excludeAuthors.includes(username)) reasons.push("excluded-author");

  if (!post.lang || !ctx.languages.includes(post.lang)) reasons.push("language");

  const excludedMatches = matchTerms(post.text, niche.excludedKeywords);
  if (excludedMatches.length) reasons.push("excluded-keyword");

  const age = postAgeMinutes(post, now);
  if (age < filters.minPostAgeMinutes) reasons.push("too-new");
  if (age > filters.maxPostAgeMinutes) reasons.push("too-old");

  if (meaningfulLength(post.text) < filters.minTextLength) reasons.push("too-short");
  if (extractHashtags(post.text).length > filters.maxHashtags) reasons.push("hashtag-spam");
  if (extractMentions(post.text).length > 5) reasons.push("mention-spam");

  const min = filters.minimumEngagement;
  if (
    post.metrics.likes < min.likes ||
    post.metrics.replies < min.replies ||
    post.metrics.reposts < min.reposts
  ) {
    reasons.push("low-engagement");
  }

  return { passed: reasons.length === 0, reasons, excludedMatches };
}
