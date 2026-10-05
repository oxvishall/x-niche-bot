/**
 * Provider-agnostic text generation. Each AI vendor gets one implementation;
 * the rest of the app only depends on this interface.
 */

export interface GenerateRequest {
  /** Stable instructions (persona, rules). */
  system: string;
  /** The per-call task, e.g. the post to reply to. */
  prompt: string;
}

export interface GenerateResult {
  text: string;
  model: string;
}

export interface AiProvider {
  readonly name: string;
  generate(request: GenerateRequest): Promise<GenerateResult>;
}

/** The model declined to answer (safety refusal). Not retryable as-is. */
export class AiRefusalError extends Error {
  constructor(readonly category?: string | null) {
    super(`AI provider refused the request${category ? ` (${category})` : ""}`);
    this.name = "AiRefusalError";
  }
}
