import type { NicheConfig } from "../config/niche.schema.js";

/** System-prompt fragment describing who the bot is and how it writes. */
export function voiceInstructions(config: NicheConfig): string {
  const { voice, niche } = config;
  const lines = [
    `You write on X as ${voice.persona}.`,
    `Niche: ${niche.description ?? niche.name}.`,
    `Tone: ${voice.tone}.`,
    "Write like a thoughtful human, not a brand: plain words, no buzzwords, no flattery, no emoji strings.",
    "Never claim to be an AI, never give financial, medical or legal advice, and never invent facts, numbers or quotes.",
  ];
  if (voice.guidelines.length) {
    lines.push("Additional rules:", ...voice.guidelines.map((g) => `- ${g}`));
  }
  return lines.join("\n");
}
