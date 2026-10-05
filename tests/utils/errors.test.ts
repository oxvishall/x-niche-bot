import { describe, expect, it } from "vitest";
import { formatError } from "../../src/utils/errors.js";

describe("formatError", () => {
  it("expands empty AggregateErrors and appends error codes", () => {
    const refused = (address: string) =>
      Object.assign(new Error(`connect ECONNREFUSED ${address}`), { code: "ECONNREFUSED" });
    const error = new AggregateError([refused("::1:5432"), refused("127.0.0.1:5432")], "");
    expect(formatError(error)).toBe("connect ECONNREFUSED ::1:5432; connect ECONNREFUSED 127.0.0.1:5432");
    expect(formatError(Object.assign(new Error(""), { code: "ETIMEDOUT" }))).toBe("Error (ETIMEDOUT)");
    expect(formatError("plain")).toBe("plain");
  });
});
