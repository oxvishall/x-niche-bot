import { describe, expect, it } from "vitest";
import { EnvValidationError, parseEnv } from "../../src/config/env.js";

const minimal = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/test",
  BOT_NAME: "test-bot",
};

describe("parseEnv", () => {
  it("applies safe defaults for a minimal environment", () => {
    const env = parseEnv(minimal);
    expect(env.DRY_RUN).toBe(true);
    expect(env.BOT_ENABLED).toBe(true);
    expect(env.AI_PROVIDER).toBe("none");
    expect(env.SEARCH_MAX_RESULTS).toBe(25);
  });

  it("treats blank values (as copied from .env.example) as unset", () => {
    const env = parseEnv({ ...minimal, MAX_REPLIES_PER_HOUR: "", DRY_RUN: "" });
    expect(env.MAX_REPLIES_PER_HOUR).toBe(5);
    expect(env.DRY_RUN).toBe(true);
  });

  it("coerces numeric and boolean strings", () => {
    const env = parseEnv({ ...minimal, SEARCH_MAX_RESULTS: "50", BOT_ENABLED: "false" });
    expect(env.SEARCH_MAX_RESULTS).toBe(50);
    expect(env.BOT_ENABLED).toBe(false);
  });

  it("rejects missing required variables and out-of-range values", () => {
    expect(() => parseEnv({ BOT_NAME: "x", SEARCH_MAX_RESULTS: "500" })).toThrow(
      EnvValidationError,
    );
  });

  it("requires X credentials when DRY_RUN=false", () => {
    expect(() => parseEnv({ ...minimal, DRY_RUN: "false" })).toThrow(/X_API_KEY/);
  });

  it("requires AI key and model when a provider is set", () => {
    expect(() => parseEnv({ ...minimal, AI_PROVIDER: "anthropic" })).toThrow(/AI_API_KEY/);
  });

  it("never includes secret values in error messages", () => {
    const secret = "super-secret-value-123";
    try {
      parseEnv({ ...minimal, X_API_KEY: secret, SEARCH_MAX_RESULTS: "9999" });
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });
});
