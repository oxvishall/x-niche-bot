import Anthropic from "@anthropic-ai/sdk";
import { AiRefusalError, type AiProvider, type GenerateRequest, type GenerateResult } from "./provider.js";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** Models that accept server-side refusal fallbacks (`fallbacks: "default"`). */
const FALLBACK_MODELS = new Set([
  "claude-fable-5-1",
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-sonnet-5-5",
]);

export interface AnthropicProviderOptions {
  apiKey: string;
  model: string;
  effort?: Effort;
  /** Injected for tests. */
  client?: Anthropic;
}

export class AnthropicProvider implements AiProvider {
  readonly name = "anthropic";
  private readonly client: Anthropic;

  constructor(private readonly options: AnthropicProviderOptions) {
    this.client = options.client ?? new Anthropic({ apiKey: options.apiKey });
  }

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const useFallbacks = FALLBACK_MODELS.has(this.options.model);
    const response = await this.client.beta.messages.create({
      model: this.options.model,
      max_tokens: 16000,
      system: request.system,
      messages: [{ role: "user", content: request.prompt }],
      ...(this.options.effort && { output_config: { effort: this.options.effort } }),
      ...(useFallbacks && {
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default" as const,
      }),
    });

    if (response.stop_reason === "refusal") {
      throw new AiRefusalError(response.stop_details?.category);
    }

    const text = response.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("")
      .trim();
    return { text, model: response.model };
  }
}
