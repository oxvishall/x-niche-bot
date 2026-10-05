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
    /** How the bot writes. Shared by replies and original posts. */
    voice: z
      .object({
        persona: z.string().min(1).default("a knowledgeable, friendly practitioner in this niche"),
        tone: z.string().min(1).default("conversational, concise and specific"),
        /** Extra rules for the model, e.g. "never give financial advice". */
        guidelines: stringList,
        /** Phrases generated text must never contain (case-insensitive). */
        bannedPhrases: stringList,
      })
      .prefault({}),
    engagement: z
      .object({
        enabled: z.boolean().default(false),
        /**
         * "review": generated replies wait for human approval.
         * "auto": approved automatically (requires delivery "api").
         */
        mode: z.enum(["review", "auto"]).default("review"),
        /**
         * "intent": you post approved replies yourself via an X web-intent link.
         * "api": posted through the X API. Since Feb 2026 X only allows API replies
         * when the author mentioned/quoted you, unless you have Enterprise access.
         */
        delivery: z.enum(["intent", "api"]).default("intent"),
        /** Niche-specific hourly cap. Omit to use MAX_REPLIES_PER_HOUR; the lower one wins. */
        maxRepliesPerHour: z.number().int().min(0).optional(),
        /** In review mode, stop drafting while this many drafts await review. */
        maxPendingReviews: z.number().int().min(1).default(20),
        /** Replies drafted per engagement run (each costs one AI call). */
        maxDraftsPerRun: z.number().int().min(0).max(50).default(3),
        maxRepliesPerAuthorPerDay: z.number().int().min(1).default(1),
        /** X weighted characters. */
        maxLength: z.number().int().min(20).max(280).default(240),
        allowHashtags: z.boolean().default(false),
        allowLinks: z.boolean().default(false),
        /** Replies at least this similar (0–1) to a recent one are rejected. */
        similarityThreshold: ratio.default(0.6),
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
    if (config.engagement.mode === "auto" && config.engagement.delivery !== "api") {
      ctx.addIssue({
        code: "custom",
        path: ["engagement", "mode"],
        message: 'mode "auto" requires delivery "api" (intent delivery needs a human)',
      });
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
