import { describe, expect, it } from "vitest";
import { loadNicheConfig, NicheConfigError, parseNicheConfig } from "../../src/config/index.js";

describe("niche config", () => {
  it("loads the bundled example config", async () => {
    const config = await loadNicheConfig("config/niches/example.json");
    expect(config.niche.name).toBe("example");
    expect(config.engagement.enabled).toBe(false);
    expect(config.engagement.mode).toBe("review");
  });

  it("fills defaults and normalizes author handles", () => {
    const config = parseNicheConfig({
      niche: { name: "web3-defi", searchQueries: ["defi", "#DeFi"] },
      targeting: { includeAuthors: ["@SomeAuthor"] },
    });
    expect(config.niche.languages).toEqual(["en"]);
    expect(config.niche.minimumRelevanceScore).toBe(0.5);
    expect(config.targeting.includeAuthors).toEqual(["someauthor"]);
    expect(config.publishing.enabled).toBe(false);
  });

  it("rejects an invalid niche name", () => {
    expect(() => parseNicheConfig({ niche: { name: "Bad Name!" } })).toThrow(NicheConfigError);
  });

  it("requires search queries when engagement is enabled", () => {
    expect(() =>
      parseNicheConfig({ niche: { name: "empty" }, engagement: { enabled: true } }),
    ).toThrow(/searchQueries/);
  });
});
