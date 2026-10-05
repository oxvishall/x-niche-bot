import { describe, expect, it } from "vitest";
import { buildSearchQuery, createDiscoveryContext, deriveTerms } from "../../src/discovery/query.js";
import { makeNiche } from "../helpers.js";

describe("deriveTerms", () => {
  it("extracts keywords, phrases and hashtags while skipping operators", () => {
    const terms = deriveTerms([
      "web3",
      '"decentralized finance" -"rug pull"',
      "#DeFi",
      "(ethereum OR arbitrum) defi -scam lang:en from:someone @mention $ETH",
    ]);
    expect(terms.keywords).toEqual(["web3", "decentralized finance", "ethereum", "arbitrum", "defi"]);
    expect(terms.hashtags).toEqual(["defi"]);
  });
});

describe("buildSearchQuery", () => {
  it("adds language and post-type operators", () => {
    expect(
      buildSearchQuery("defi OR web3", {
        languages: ["en"],
        excludeReplies: true,
        excludeQuotes: false,
      }),
    ).toBe("(defi OR web3) lang:en -is:retweet -is:reply");

    expect(
      buildSearchQuery("#DeFi", { languages: ["en", "es"], excludeReplies: false, excludeQuotes: true }),
    ).toBe("(#DeFi) (lang:en OR lang:es) -is:retweet -is:quote");
  });
});

describe("createDiscoveryContext", () => {
  it("prefers explicit terms and falls back to SEARCH_LANGUAGE", () => {
    const ctx = createDiscoveryContext(
      makeNiche({ niche: { name: "n", searchQueries: ["defi"], keywords: ["yield"], languages: [] } }),
      "de",
    );
    expect(ctx.keywords).toEqual(["yield"]);
    expect(ctx.hashtags).toEqual([]);
    expect(ctx.languages).toEqual(["de"]);
  });
});
