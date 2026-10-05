import { describe, expect, it } from "vitest";
import { buildOAuth1Header, percentEncode } from "../../src/x/oauth1.js";

describe("OAuth 1.0a signing", () => {
  it("percent-encodes per RFC 3986", () => {
    expect(percentEncode("Ladies + Gentlemen!*'()")).toBe(
      "Ladies%20%2B%20Gentlemen%21%2A%27%28%29",
    );
  });

  // Reference example from X's "Creating a signature" documentation.
  it("matches the documented reference signature", () => {
    const header = buildOAuth1Header({
      method: "POST",
      url: "https://api.twitter.com/1.1/statuses/update.json?include_entities=true",
      bodyParams: { status: "Hello Ladies + Gentlemen, a signed OAuth request!" },
      credentials: {
        apiKey: "xvz1evFS4wEEPTGEFPHBog",
        apiSecret: "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
        accessToken: "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
        accessTokenSecret: "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE",
      },
      nonce: "kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg",
      timestamp: 1318622958,
    });
    expect(header).toContain(`oauth_signature="${percentEncode("hCtSmYh+iHYCEqBWrE7C7hYmtUk=")}"`);
    expect(header.startsWith("OAuth ")).toBe(true);
  });
});
