import type { Logger } from "pino";
import type { Env } from "../config/env.js";
import { XApiClient } from "./api-client.js";
import type { XClient } from "./client.js";
import { DryRunXClient } from "./dry-run-client.js";

export type * from "./client.js";
export { XApiError, XRateLimitError } from "./errors.js";
export { DRY_RUN_ID_PREFIX, dryRunPoster } from "./dry-run-client.js";

/**
 * Builds the X client for the current environment. Returns null when
 * credentials are missing (only possible in dry-run mode — env validation
 * requires them otherwise). Writes are always disabled when DRY_RUN=true.
 */
export function createXClient(env: Env, logger: Logger): XClient | null {
  const { X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_TOKEN_SECRET } = env;
  if (!X_API_KEY || !X_API_SECRET || !X_ACCESS_TOKEN || !X_ACCESS_TOKEN_SECRET) {
    return null;
  }

  const client = new XApiClient({
    credentials: {
      apiKey: X_API_KEY,
      apiSecret: X_API_SECRET,
      accessToken: X_ACCESS_TOKEN,
      accessTokenSecret: X_ACCESS_TOKEN_SECRET,
    },
    logger: logger.child({ module: "x-api" }),
  });
  return env.DRY_RUN ? new DryRunXClient(client, logger.child({ module: "x-dry-run" })) : client;
}
