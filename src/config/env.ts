import { z } from "zod";

const boolish = z.stringbool({
  truthy: ["true", "1", "yes", "on"],
  falsy: ["false", "0", "no", "off"],
});

const int = (min: number, max = Number.MAX_SAFE_INTEGER) =>
  z.coerce.number().int().min(min).max(max);

const optionalSecret = z.string().min(1).optional();

export const AI_PROVIDERS = ["none", "anthropic"] as const;

/** Names of env vars holding secrets. Used for log redaction. */
export const SECRET_ENV_KEYS = [
  "X_API_KEY",
  "X_API_SECRET",
  "X_ACCESS_TOKEN",
  "X_ACCESS_TOKEN_SECRET",
  "AI_API_KEY",
  "DATABASE_URL",
] as const;

export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    LOG_LEVEL: z
      .enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"])
      .default("info"),

    // X API (OAuth 1.0a user context)
    X_API_KEY: optionalSecret,
    X_API_SECRET: optionalSecret,
    X_ACCESS_TOKEN: optionalSecret,
    X_ACCESS_TOKEN_SECRET: optionalSecret,

    // Database
    DATABASE_URL: z
      .string()
      .regex(/^postgres(ql)?:\/\//, "must be a postgresql:// connection string"),

    // Bot
    BOT_NAME: z.string().min(1),
    BOT_ENABLED: boolish.default(true),
    DRY_RUN: boolish.default(true),
    NICHE_CONFIG_PATH: z.string().min(1).default("config/niches/example.json"),

    // Search
    SEARCH_LANGUAGE: z.string().min(2).default("en"),
    SEARCH_MAX_RESULTS: int(10, 100).default(25),
    SEARCH_LOOKBACK_MINUTES: int(1).default(60),

    // Rate limits
    MAX_REPLIES_PER_HOUR: int(0).default(5),
    MAX_REPLIES_PER_DAY: int(0).default(30),
    MAX_POSTS_PER_DAY: int(0).default(3),

    // Scheduling
    DISCOVERY_INTERVAL_MINUTES: int(1).default(15),
    PUBLISH_INTERVAL_MINUTES: int(1).default(240),

    // AI
    AI_PROVIDER: z.enum(AI_PROVIDERS).default("none"),
    AI_API_KEY: optionalSecret,
    AI_MODEL: z.string().min(1).optional(),
    /** Optional reasoning effort for providers that support it. */
    AI_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
  })
  .superRefine((env, ctx) => {
    if (!env.DRY_RUN) {
      for (const key of [
        "X_API_KEY",
        "X_API_SECRET",
        "X_ACCESS_TOKEN",
        "X_ACCESS_TOKEN_SECRET",
      ] as const) {
        if (!env[key]) {
          ctx.addIssue({ code: "custom", path: [key], message: "required when DRY_RUN=false" });
        }
      }
    }
    if (env.AI_PROVIDER !== "none") {
      for (const key of ["AI_API_KEY", "AI_MODEL"] as const) {
        if (!env[key]) {
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: `required when AI_PROVIDER=${env.AI_PROVIDER}`,
          });
        }
      }
    }
    if (env.MAX_REPLIES_PER_HOUR > env.MAX_REPLIES_PER_DAY) {
      ctx.addIssue({
        code: "custom",
        path: ["MAX_REPLIES_PER_HOUR"],
        message: "must not exceed MAX_REPLIES_PER_DAY",
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid environment configuration:\n  - ${issues.join("\n  - ")}`);
    this.name = "EnvValidationError";
  }
}

/**
 * Validates environment variables. Empty strings are treated as unset so that
 * blank entries copied from `.env.example` fall back to defaults.
 * Error messages name the variable but never include its value.
 */
export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value.trim() !== ""),
  );
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`),
    );
  }
  return result.data;
}
