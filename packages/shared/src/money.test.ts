import { describe, expect, it } from "vitest";
import { formatMinor } from "./money";

describe("formatMinor", () => {
  it("formats GBP minor units", () => expect(formatMinor(2490, "GBP")).toBe("£24.90"));
  it("handles zero-decimal currencies", () => expect(formatMinor(500, "JPY", "en-US")).toBe("¥500"));
  it("rejects fractional minor units", () => expect(() => formatMinor(24.9, "GBP")).toThrow());
});
