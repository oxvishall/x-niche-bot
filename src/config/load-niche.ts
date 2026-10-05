import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { nicheConfigSchema, type NicheConfig } from "./niche.schema.js";

export class NicheConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NicheConfigError";
  }
}

export function parseNicheConfig(input: unknown, source = "niche config"): NicheConfig {
  const result = nicheConfigSchema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
    );
    throw new NicheConfigError(`Invalid ${source}:\n  - ${issues.join("\n  - ")}`);
  }
  return result.data;
}

/** Loads and validates a JSON niche config file. */
export async function loadNicheConfig(path: string): Promise<NicheConfig> {
  const absolutePath = resolve(path);
  let raw: string;
  try {
    raw = await readFile(absolutePath, "utf8");
  } catch (error) {
    throw new NicheConfigError(`Cannot read niche config at ${absolutePath}: ${String(error)}`);
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    throw new NicheConfigError(`Niche config at ${absolutePath} is not valid JSON: ${String(error)}`);
  }

  return parseNicheConfig(json, absolutePath);
}
