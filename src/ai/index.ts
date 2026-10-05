import type { Env } from "../config/env.js";
import { AnthropicProvider } from "./anthropic-provider.js";
import type { AiProvider } from "./provider.js";

export * from "./provider.js";

/** Returns null when AI_PROVIDER=none. Add new providers here. */
export function createAiProvider(env: Env): AiProvider | null {
  switch (env.AI_PROVIDER) {
    case "none":
      return null;
    case "anthropic":
      // env validation guarantees key and model are set for a real provider.
      return new AnthropicProvider({
        apiKey: env.AI_API_KEY!,
        model: env.AI_MODEL!,
        ...(env.AI_EFFORT && { effort: env.AI_EFFORT }),
      });
  }
}
