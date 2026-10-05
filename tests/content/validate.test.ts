import { describe, expect, it } from "vitest";
import { validateContent, type ContentRules } from "../../src/content/validate.js";

const rules: ContentRules = {
  maxLength: 120,
  allowHashtags: false,
  allowLinks: false,
  allowedMentions: [],
  bannedPhrases: ["to the moon"],
  excludedKeywords: ["giveaway"],
  similarityThreshold: 0.6,
  recentTexts: ["Collateral ratios matter more than APY when markets turn volatile."],
};

describe("validateContent", () => {
  it("accepts a clean reply and strips wrapping quotes", () => {
    const result = validateContent('"Curious how they handle oracle delays during liquidations?"', rules);
    expect(result).toMatchObject({
      status: "ok",
      text: "Curious how they handle oracle delays during liquidations?",
    });
  });

  it("treats SKIP as a deliberate decline", () => {
    expect(validateContent("SKIP", rules)).toEqual({ status: "skip" });
    expect(validateContent(" skip ", rules)).toEqual({ status: "skip" });
  });

  it.each([
    ["contains-link", "Read this https://example.com for the full breakdown"],
    ["contains-hashtag", "Lending risk is underrated #DeFi"],
    ["mentions (bob)", "Agree with @bob on oracle risk here"],
    ["banned-phrase (great point)", "Great point, oracle risk is underrated"],
    ["banned-phrase (to the moon)", "This protocol is going to the moon"],
    ["excluded-keyword (giveaway)", "Is this tied to the giveaway?"],
    ["too-long", "x".repeat(130)],
  ])("rejects with %s", (issue, text) => {
    const result = validateContent(text, rules);
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.issues.some((i) => i.startsWith(issue))).toBe(true);
    }
  });

  it("rejects duplicates and near-duplicates of recent texts", () => {
    const exact = validateContent("collateral ratios matter more than APY when markets turn volatile", rules);
    expect(exact).toMatchObject({ status: "invalid", issues: ["duplicate"] });

    const near = validateContent(
      "Collateral ratios matter more than APY when markets turn volatile, always.",
      rules,
    );
    expect(near).toMatchObject({ status: "invalid", issues: ["near-duplicate"] });
  });

  it("allows mentions of permitted users", () => {
    expect(validateContent("@alice fair, oracle lag is the real risk", { ...rules, allowedMentions: ["alice"] }).status).toBe("ok");
  });
});
