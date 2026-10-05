import { z } from "zod";

const stringList = z.array(z.string().trim().min(1)).default([]);

/** X usernames, stored without the leading "@" and lowercased. */
const usernameList = z
  .array(
    z
      .string()
      .trim()
      .transform((value) => value.replace(/^@/, "").toLowerCase())
      .pipe(z.string().regex(/^[a-z0-9_]{1,15}$/, "invalid X username")),
  )
  .default([]);

/** Hashtags, stored without the leading "#" and lowercased. */
const hashtagList = z
  .array(
    z
      .string()
      .trim()
      .transform((value) => value.replace(/^#/, "").toLowerCase())
      .pipe(z.string().regex(/^[\p{L}\p{N}_]+$/u, "invalid hashtag")),
  )
  .default([]);

const ratio = z.number().min(0).max(1);

const searchSchema = z
  .object({
    /** Appends `-is:reply` so only top-level posts are found. */
    excludeReplies: z.boolean().default(true),
    /** Appends `-is:quote`. */
    excludeQuotes: z.boolean().default(false),
    /** Pages fetched per query per run. Each page costs API quota. */
    maxPagesPerQuery: z.number().int().min(1).max(10).default(1),
  })
  .prefault({});

const filtersSchema = z
  .object({
    minPostAgeMinutes: z.number().min(0).default(2),
    maxPostAgeMinutes: z.number().positive().default(720),
    minTextLength: z.number().int().min(0).default(20),
    /** Posts with more hashtags than this are treated as spam. */
    maxHashtags: z.number().int().min(0).default(5),
    minimumEngagement: z
      .object({
        likes: z.number().int().min(0).default(0),
        replies: z.number().int().min(0).default(0),
        reposts: z.number().int().min(0).default(0),
      })
      .prefault({}),
  })
  .prefault({})
  .refine((f) => f.maxPostAgeMinutes > f.minPostAgeMinutes, {
    message: "maxPostAgeMinutes must be greater than minPostAgeMinutes",
  });

const scoringSchema = z
  .object({
    /** Relative weights; they are normalized, so they need not sum to 1. */
    weights: z
      .object({
        keyword: ratio.default(0.35),
        hashtag: ratio.default(0.15),
        author: ratio.default(0.1),
        engagement: ratio.default(0.2),
        recency: ratio.default(0.2),
      })
      .prefault({}),
    /** Number of keyword matches that earns the full keyword score. */
    keywordSaturation: z.number().int().min(1).default(2),
    /** Weighted interactions (likes + 2×replies + 3×reposts/quotes) that earn the full engagement score. */
    engagementTarget: z.number().positive().default(50),
  })
  .prefault({});

export const nicheConfigSchema = z
  .object({
    niche: z.object({
      /** Slug used to tag every database row belonging to this niche. */
      name: z
        .string()
        .regex(/^[a-z0-9][a-z0-9-]*$/, "use lowercase letters, numbers and dashes"),
      description: z.string().optional(),
      /** X search queries (full X query syntax). */
      searchQueries: stringList,
      /** Terms used for relevance scoring. Derived from searchQueries when empty. */
      keywords: stringList,
      /** Hashtags used for relevance scoring. Derived from searchQueries when empty. */
      hashtags: hashtagList,
      excludedKeywords: stringList,
      /** Post languages to accept. Falls back to SEARCH_LANGUAGE when empty. */
      languages: z.array(z.string().min(2)).default([]),
      /** Posts scoring below this (0–1) are never engaged with. */
      minimumRelevanceScore: ratio.default(0.5),
    }),
    targeting: z
      .object({
        includeAuthors: usernameList,
        excludeAuthors: usernameList,
      })
      .prefault({}),
    search: searchSchema,
    filters: filtersSchema,
    scoring: scoringSchema,
    engagement: z
      .object({
        enabled: z.boolean().default(false),
        /**
         * "review": generated replies are queued for human approval.
         * "auto": replies are posted automatically (only where X automation rules allow).
         */
        mode: z.enum(["review", "auto"]).default("review"),
        maxRepliesPerHour: z.number().int().min(0).default(0),
      })
      .prefault({}),
    publishing: z
      .object({
        enabled: z.boolean().default(false),
        postsPerDay: z.number().int().min(0).default(0),
      })
      .prefault({}),
  })
  .superRefine((config, ctx) => {
    if (config.engagement.enabled && config.niche.searchQueries.length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["niche", "searchQueries"],
        message: "at least one search query is required when engagement is enabled",
      });
    }
    const excluded = new Set(config.targeting.excludeAuthors);
    for (const author of config.targeting.includeAuthors) {
      if (excluded.has(author)) {
        ctx.addIssue({
          code: "custom",
          path: ["targeting"],
          message: `author "${author}" is both included and excluded`,
        });
      }
    }
    if (Object.values(config.scoring.weights).every((w) => w === 0)) {
      ctx.addIssue({
        code: "custom",
        path: ["scoring", "weights"],
        message: "at least one scoring weight must be greater than 0",
      });
    }
  });

export type NicheConfig = z.infer<typeof nicheConfigSchema>;
export type NicheConfigInput = z.input<typeof nicheConfigSchema>;
