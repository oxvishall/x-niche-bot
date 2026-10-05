import {
  contentHash,
  containsTerm,
  extractHashtags,
  extractMentions,
  extractUrls,
  similarity,
  xWeightedLength,
} from "../utils/text.js";

/** The model's way of declining to write anything. */
export const SKIP_TOKEN = "SKIP";

/** Openers and tells that make generated text read as generic or bot-written. */
export const DEFAULT_BANNED_PHRASES = [
  "as an ai",
  "language model",
  "great post",
  "great point",
  "great thread",
  "love this",
  "so true",
  "this is so insightful",
  "couldn't agree more",
  "absolutely agree",
  "thanks for sharing",
  "game changer",
  "game-changer",
  "delve",
];

export interface ContentRules {
  maxLength: number;
  allowHashtags: boolean;
  allowLinks: boolean;
  /** Usernames (lowercase, no "@") that may be mentioned. */
  allowedMentions: string[];
  bannedPhrases: string[];
  excludedKeywords: string[];
  similarityThreshold: number;
  /** Recently generated texts, to block duplicates and near-duplicates. */
  recentTexts: string[];
}

export type ValidationResult =
  | { status: "ok"; text: string; hash: string }
  | { status: "skip" }
  | { status: "invalid"; text: string; issues: string[] };

/** Trims whitespace and wrapping quotes the model sometimes adds. */
export function cleanGeneratedText(raw: string): string {
  let text = raw.trim();
  const quotes: [string, string][] = [['"', '"'], ["“", "”"], ["'", "'"]];
  for (const [open, close] of quotes) {
    if (text.length > 1 && text.startsWith(open) && text.endsWith(close)) {
      text = text.slice(1, -1).trim();
    }
  }
  return text;
}

export function validateContent(raw: string, rules: ContentRules): ValidationResult {
  const text = cleanGeneratedText(raw);
  if (text.toUpperCase() === SKIP_TOKEN || text.toUpperCase().startsWith(`${SKIP_TOKEN}\n`)) {
    return { status: "skip" };
  }

  const issues: string[] = [];
  if (!text) issues.push("empty");

  const length = xWeightedLength(text);
  if (length > rules.maxLength) issues.push(`too-long (${length}/${rules.maxLength})`);
  if (!rules.allowLinks && extractUrls(text).length) issues.push("contains-link");
  if (!rules.allowHashtags && extractHashtags(text).length) issues.push("contains-hashtag");

  const allowed = new Set(rules.allowedMentions);
  const strayMentions = extractMentions(text).filter((m) => !allowed.has(m));
  if (strayMentions.length) issues.push(`mentions (${strayMentions.join(", ")})`);

  for (const phrase of [...DEFAULT_BANNED_PHRASES, ...rules.bannedPhrases]) {
    if (containsTerm(text, phrase)) issues.push(`banned-phrase (${phrase})`);
  }
  for (const keyword of rules.excludedKeywords) {
    if (containsTerm(text, keyword)) issues.push(`excluded-keyword (${keyword})`);
  }

  const hash = contentHash(text);
  for (const recent of rules.recentTexts) {
    if (contentHash(recent) === hash) {
      issues.push("duplicate");
      break;
    }
    if (similarity(text, recent) >= rules.similarityThreshold) {
      issues.push("near-duplicate");
      break;
    }
  }

  return issues.length ? { status: "invalid", text, issues } : { status: "ok", text, hash };
}
