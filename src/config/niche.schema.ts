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

export const nicheConfigSchema = z
  .object({
    niche: z.object({
      /** Slug used to tag every database row belonging to this niche. */
      name: z
        .string()
        .regex(/^[a-z0-9][a-z0-9-]*$/, "use lowercase letters, numbers and dashes"),
      description: z.string().optional(),
      searchQueries: stringList,
      excludedKeywords: stringList,
      languages: z.array(z.string().min(2)).default(["en"]),
      /** Posts scoring below this (0–1) are never engaged with. */
      minimumRelevanceScore: z.number().min(0).max(1).default(0.5),
    }),
    targeting: z
      .object({
        includeAuthors: usernameList,
        excludeAuthors: usernameList,
      })
      .default({ includeAuthors: [], excludeAuthors: [] }),
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
      .default({ enabled: false, mode: "review", maxRepliesPerHour: 0 }),
    publishing: z
      .object({
        enabled: z.boolean().default(false),
        postsPerDay: z.number().int().min(0).default(0),
      })
      .default({ enabled: false, postsPerDay: 0 }),
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
  });

export type NicheConfig = z.infer<typeof nicheConfigSchema>;
export type NicheConfigInput = z.input<typeof nicheConfigSchema>;
