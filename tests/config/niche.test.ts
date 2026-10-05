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
    expect(config.niche.languages).toEqual([]);
    expect(config.niche.minimumRelevanceScore).toBe(0.5);
    expect(config.filters.maxPostAgeMinutes).toBe(720);
    expect(config.filters.minimumEngagement.likes).toBe(0);
    expect(config.scoring.weights.keyword).toBe(0.35);
    expect(config.search.excludeReplies).toBe(true);
    expect(config.targeting.includeAuthors).toEqual(["someauthor"]);
    expect(config.publishing.enabled).toBe(false);
  });

  it("normalizes hashtags and validates filter ranges", () => {
    const config = parseNicheConfig({ niche: { name: "n", hashtags: ["#DeFi", "web3"] } });
    expect(config.niche.hashtags).toEqual(["defi", "web3"]);
    expect(() =>
      parseNicheConfig({
        niche: { name: "n" },
        filters: { minPostAgeMinutes: 60, maxPostAgeMinutes: 30 },
      }),
    ).toThrow(/maxPostAgeMinutes/);
  });

  it("rejects an invalid niche name", () => {
    expect(() => parseNicheConfig({ niche: { name: "Bad Name!" } })).toThrow(NicheConfigError);
  });

  it("requires search queries when engagement is enabled", () => {
    expect(() =>
      parseNicheConfig({ niche: { name: "empty" }, engagement: { enabled: true } }),
    ).toThrow(/searchQueries/);
  });

  it("defaults to review + intent delivery and rejects auto without api delivery", () => {
    const config = parseNicheConfig({ niche: { name: "n" } });
    expect(config.engagement).toMatchObject({ mode: "review", delivery: "intent" });
    expect(() =>
      parseNicheConfig({ niche: { name: "n" }, engagement: { mode: "auto" } }),
    ).toThrow(/delivery "api"/);
  });
});
