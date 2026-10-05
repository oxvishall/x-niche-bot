import { parseNicheConfig, type NicheConfig, type NicheConfigInput } from "../src/config/index.js";
import type { NormalizedPost } from "../src/types/index.js";
import { createLogger } from "../src/utils/logger.js";

export const silentLogger = createLogger({ level: "silent" });

export const NOW = new Date("2026-10-05T12:00:00.000Z");

export function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60_000);
}

export function makePost(overrides: Partial<NormalizedPost> = {}): NormalizedPost {
  return {
    platform: "X",
    id: "1001",
    text: "DeFi lending protocols are getting much better at risk management lately",
    authorId: "author-1",
    author: { id: "author-1", username: "alice" },
    lang: "en",
    conversationId: "1001",
    isRepost: false,
    isQuote: false,
    createdAt: minutesAgo(30),
    metrics: { likes: 10, replies: 2, reposts: 1, quotes: 0 },
    ...overrides,
  };
}

export function makeNiche(overrides: Partial<NicheConfigInput> = {}): NicheConfig {
  return parseNicheConfig({
    niche: {
      name: "test-niche",
      searchQueries: ["defi", '"decentralized finance"', "#DeFi", "(ethereum OR arbitrum) lending"],
      excludedKeywords: ["giveaway", "airdrop"],
      languages: ["en"],
      minimumRelevanceScore: 0.4,
    },
    ...overrides,
  });
}
