import { describe, expect, it } from "vitest";
import { formatAgo, formatDay, formatWhen } from "./format.js";

const now = Date.parse("2026-11-11T12:00:00Z");
const ago = (ms: number) => new Date(now - ms).toISOString();

describe("formatAgo", () => {
  it.each([
    [10_000, "just now"],
    [60_000, "1 minute ago"],
    [12 * 60_000, "12 minutes ago"],
    [60 * 60_000, "1 hour ago"],
    [3 * 3_600_000, "3 hours ago"],
    [48 * 3_600_000, "2 days ago"],
  ])("says %i ms as %s", (ms, words) => {
    expect(formatAgo(ago(ms), now)).toBe(words);
  });
});

describe("dates are written in British English", () => {
  it("puts the day before the month and uses the 24-hour clock", () => {
    expect(formatDay("2026-11-10T14:30:00Z")).toMatch(/^10 Nov 2026$/);
    expect(formatWhen("2026-11-10T14:30:00Z")).toMatch(/^10 Nov 2026, \d{2}:\d{2}$/);
  });
});
