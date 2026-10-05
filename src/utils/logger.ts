import pino, { type DestinationStream, type Logger, type LoggerOptions } from "pino";
import { SECRET_ENV_KEYS } from "../config/env.js";

/** Field names that must never appear in logs, at the top level or one level deep. */
const SECRET_FIELDS = [
  ...SECRET_ENV_KEYS,
  "apiKey",
  "apiSecret",
  "accessToken",
  "accessTokenSecret",
  "token",
  "secret",
  "password",
  "authorization",
  "connectionString",
];

export const REDACT_PATHS = [
  ...SECRET_FIELDS,
  ...SECRET_FIELDS.map((field) => `*.${field}`),
  "headers.authorization",
  "*.headers.authorization",
];

export interface CreateLoggerOptions {
  level?: LoggerOptions["level"];
  name?: string;
  /** Human-readable output for local development (requires pino-pretty). */
  pretty?: boolean;
  /** Custom destination, mainly for tests. */
  destination?: DestinationStream;
}

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const config: LoggerOptions = {
    level: options.level ?? "info",
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    ...(options.name ? { name: options.name } : {}),
  };

  if (options.destination) {
    return pino(config, options.destination);
  }
  if (options.pretty) {
    return pino({ ...config, transport: { target: "pino-pretty", options: { colorize: true } } });
  }
  return pino(config);
}

export type { Logger };
