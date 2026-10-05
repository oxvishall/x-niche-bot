import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { AnthropicProvider } from "../../src/ai/anthropic-provider.js";
import { AiRefusalError } from "../../src/ai/provider.js";

function stubClient(response: object) {
  const create = vi.fn().mockResolvedValue(response);
  return { client: { beta: { messages: { create } } } as unknown as Anthropic, create };
}

describe("AnthropicProvider", () => {
  it("joins text blocks and enables refusal fallbacks on supported models", async () => {
    const { client, create } = stubClient({
      model: "claude-opus-5-5",
      stop_reason: "end_turn",
      stop_details: null,
      content: [
        { type: "thinking", thinking: "" },
        { type: "text", text: " Great point " },
      ],
    });
    const provider = new AnthropicProvider({ apiKey: "k", model: "claude-opus-5-5", effort: "low", client });

    const result = await provider.generate({ system: "sys", prompt: "hi" });

    expect(result).toEqual({ text: "Great point", model: "claude-opus-5-5" });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-opus-5-5",
        system: "sys",
        messages: [{ role: "user", content: "hi" }],
        output_config: { effort: "low" },
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      }),
    );
  });

  it("omits fallbacks and effort for other models", async () => {
    const { client, create } = stubClient({
      model: "claude-haiku-4-5",
      stop_reason: "end_turn",
      content: [{ type: "text", text: "ok" }],
    });
    await new AnthropicProvider({ apiKey: "k", model: "claude-haiku-4-5", client }).generate({
      system: "s",
      prompt: "p",
    });
    const params = create.mock.calls[0]![0];
    expect(params).not.toHaveProperty("fallbacks");
    expect(params).not.toHaveProperty("output_config");
  });

  it("throws AiRefusalError on refusal", async () => {
    const { client } = stubClient({
      model: "claude-opus-5-5",
      stop_reason: "refusal",
      stop_details: { type: "refusal", category: "cyber" },
      content: [],
    });
    await expect(
      new AnthropicProvider({ apiKey: "k", model: "claude-opus-5-5", client }).generate({
        system: "s",
        prompt: "p",
      }),
    ).rejects.toBeInstanceOf(AiRefusalError);
  });
});
