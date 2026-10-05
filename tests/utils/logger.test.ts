import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger } from "../../src/utils/logger.js";

describe("logger", () => {
  it("redacts secret fields", () => {
    const lines: string[] = [];
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    const logger = createLogger({ destination });

    logger.info(
      {
        X_API_KEY: "key-123",
        AI_API_KEY: "ai-456",
        client: { accessToken: "tok-789" },
        headers: { authorization: "Bearer abc" },
        safe: "visible",
      },
      "test",
    );

    const output = lines.join("");
    for (const secret of ["key-123", "ai-456", "tok-789", "Bearer abc"]) {
      expect(output).not.toContain(secret);
    }
    expect(output).toContain("visible");
    expect(output).toContain("[REDACTED]");
  });
});
