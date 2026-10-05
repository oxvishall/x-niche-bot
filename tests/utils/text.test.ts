import { describe, expect, it } from "vitest";
import {
  containsTerm,
  contentHash,
  extractHashtags,
  extractMentions,
  matchTerms,
  similarity,
  xWeightedLength,
} from "../../src/utils/text.js";

describe("text utils", () => {
  it("extracts hashtags and mentions", () => {
    const text = "Loving #DeFi and #defi on #Arbitrum, cc @Alice and @bob_1. email a@b.com";
    expect(extractHashtags(text)).toEqual(["defi", "arbitrum"]);
    expect(extractMentions(text)).toEqual(["alice", "bob_1"]);
  });

  it("matches whole words and phrases only", () => {
    expect(containsTerm("DeFi is back", "defi")).toBe(true);
    expect(containsTerm("a defiant stance", "defi")).toBe(false);
    expect(containsTerm("all about Decentralized   Finance!", "decentralized finance")).toBe(true);
    expect(matchTerms("web3 and defi", ["defi", "nft", "Web3"])).toEqual(["defi", "Web3"]);
  });

  it("hashes content ignoring case, punctuation and URLs", () => {
    expect(contentHash("Great point!! https://t.co/x")).toBe(contentHash("great point"));
    expect(contentHash("great point")).not.toBe(contentHash("bad point"));
  });

  it("scores similarity between texts", () => {
    expect(similarity("this is a great thread on defi", "this is a great thread on defi")).toBe(1);
    expect(similarity("completely different words here", "nothing in common at all")).toBe(0);
    const near = similarity(
      "this is a great thread on defi lending",
      "this is a great thread on defi yields",
    );
    expect(near).toBeGreaterThan(0.6);
  });

  it("weights URLs and wide characters like X", () => {
    expect(xWeightedLength("hello")).toBe(5);
    expect(xWeightedLength("see https://example.com/very/long/path")).toBe(4 + 23);
    expect(xWeightedLength("日本")).toBe(4);
  });
});
