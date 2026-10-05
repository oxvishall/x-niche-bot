import type { NicheConfig } from "../config/niche.schema.js";
import { unique } from "../utils/text.js";

/** X recent search query limit on self-serve tiers. */
export const MAX_QUERY_LENGTH = 512;

const BOOLEAN_WORDS = new Set(["or", "and"]);

/**
 * Derives scoring terms from X search queries when the niche doesn't list
 * keywords/hashtags explicitly. Quoted phrases and plain words become
 * keywords, `#tags` become hashtags; operators (`lang:en`), negations
 * (`-spam`) and OR/AND are ignored.
 */
export function deriveTerms(queries: readonly string[]): { keywords: string[]; hashtags: string[] } {
  const keywords: string[] = [];
  const hashtags: string[] = [];

  for (const query of queries) {
    const withoutPhrases = query.replace(/(-?)"([^"]+)"/g, (_, negated: string, phrase: string) => {
      if (!negated) keywords.push(phrase.trim().toLowerCase());
      return " ";
    });
    for (const raw of withoutPhrases.replace(/[()]/g, " ").split(/\s+/)) {
      const token = raw.trim();
      if (!token || token.startsWith("-") || token.includes(":")) continue;
      if (BOOLEAN_WORDS.has(token.toLowerCase())) continue;
      if (token.startsWith("#")) {
        if (token.length > 1) hashtags.push(token.slice(1).toLowerCase());
      } else if (!token.startsWith("@") && !token.startsWith("$")) {
        keywords.push(token.toLowerCase());
      }
    }
  }
  return { keywords: unique(keywords), hashtags: unique(hashtags) };
}

export interface SearchQueryOptions {
  languages: readonly string[];
  excludeReplies: boolean;
  excludeQuotes: boolean;
}

/** Wraps a configured query with language and post-type operators. */
export function buildSearchQuery(base: string, options: SearchQueryOptions): string {
  const parts = [`(${base.trim()})`];
  if (options.languages.length === 1) {
    parts.push(`lang:${options.languages[0]}`);
  } else if (options.languages.length > 1) {
    parts.push(`(${options.languages.map((l) => `lang:${l}`).join(" OR ")})`);
  }
  parts.push("-is:retweet");
  if (options.excludeReplies) parts.push("-is:reply");
  if (options.excludeQuotes) parts.push("-is:quote");
  return parts.join(" ");
}

/** Resolved, ready-to-use discovery settings for one niche. */
export interface DiscoveryContext {
  config: NicheConfig;
  keywords: string[];
  hashtags: string[];
  languages: string[];
  /** The bot's own X user ID; its posts are never engaged with. */
  ownUserId?: string;
}

export function createDiscoveryContext(
  config: NicheConfig,
  fallbackLanguage: string,
  ownUserId?: string,
): DiscoveryContext {
  const derived = deriveTerms(config.niche.searchQueries);
  return {
    config,
    keywords: config.niche.keywords.length ? config.niche.keywords : derived.keywords,
    hashtags: config.niche.hashtags.length ? config.niche.hashtags : derived.hashtags,
    languages: config.niche.languages.length ? config.niche.languages : [fallbackLanguage],
    ...(ownUserId && { ownUserId }),
  };
}
