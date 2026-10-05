import { createHash } from "node:crypto";

const URL_PATTERN = /https?:\/\/\S+/gi;
const HASHTAG_PATTERN = /(?:^|[^\p{L}\p{N}_&])#([\p{L}\p{N}_]+)/gu;
const MENTION_PATTERN = /(?:^|[^\p{L}\p{N}_])@([A-Za-z0-9_]{1,15})/gu;

/** Lowercase, strip URLs, collapse whitespace. Used for matching and hashing. */
export function normalizeText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(URL_PATTERN, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Lowercased hashtags without "#", in order of appearance, deduplicated. */
export function extractHashtags(text: string): string[] {
  return unique([...text.matchAll(HASHTAG_PATTERN)].map((m) => m[1]!.toLowerCase()));
}

/** Lowercased @mentions without "@", deduplicated. */
export function extractMentions(text: string): string[] {
  return unique([...text.matchAll(MENTION_PATTERN)].map((m) => m[1]!.toLowerCase()));
}

export function extractUrls(text: string): string[] {
  return text.match(URL_PATTERN) ?? [];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whether `term` occurs in `text` as a whole word/phrase (case-insensitive).
 * "defi" matches "DeFi is great" but not "defiant".
 */
export function containsTerm(text: string, term: string): boolean {
  const needle = normalizeText(term);
  if (!needle) return false;
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(needle)}(?![\\p{L}\\p{N}_])`, "u");
  return pattern.test(normalizeText(text));
}

/** Terms from `terms` that occur in `text`, preserving the configured spelling. */
export function matchTerms(text: string, terms: readonly string[]): string[] {
  return unique(terms.filter((term) => containsTerm(text, term)));
}

/** Stable hash of normalized content, for exact-duplicate detection. */
export function contentHash(text: string): string {
  const canonical = normalizeText(text).replace(/[^\p{L}\p{N}\s#@]/gu, "").replace(/\s+/g, " ");
  return createHash("sha256").update(canonical).digest("hex");
}

function wordShingles(text: string, size: number): Set<string> {
  const words = normalizeText(text)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length < size) return new Set(words.length ? [words.join(" ")] : []);
  const shingles = new Set<string>();
  for (let i = 0; i <= words.length - size; i++) {
    shingles.add(words.slice(i, i + size).join(" "));
  }
  return shingles;
}

/** Jaccard similarity (0–1) of word bigrams. Used for near-duplicate detection. */
export function similarity(a: string, b: string): number {
  const sa = wordShingles(a, 2);
  const sb = wordShingles(b, 2);
  if (sa.size === 0 && sb.size === 0) return 1;
  let intersection = 0;
  for (const s of sa) if (sb.has(s)) intersection++;
  return intersection / (sa.size + sb.size - intersection);
}

/**
 * Approximates X's weighted character count: URLs count as 23, and most
 * CJK/emoji code points count as 2. Good enough to keep posts under 280.
 */
export function xWeightedLength(text: string): number {
  let length = 0;
  const withoutUrls = text.replace(URL_PATTERN, () => {
    length += 23;
    return "";
  });
  for (const char of withoutUrls.normalize("NFC")) {
    const code = char.codePointAt(0)!;
    const light =
      code <= 0x10ff ||
      (code >= 0x2000 && code <= 0x200d) ||
      (code >= 0x2010 && code <= 0x201f) ||
      (code >= 0x2032 && code <= 0x2037);
    length += light ? 1 : 2;
  }
  return length;
}

export function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
