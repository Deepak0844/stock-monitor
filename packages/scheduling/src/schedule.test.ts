import { describe, expect, it } from "vitest";
import { backoffMs, runExpirySeconds, insideWindow, intoWindow, isStale, nextCheckAt, pickDue } from "./schedule.js";

const KOLKATA = "Asia/Kolkata"; // UTC+5:30, no daylight saving
const day = { start: "07:00", end: "22:00" };
const night = { start: "22:00", end: "06:00" };
// 2026-06-10 HH:MM local Kolkata
const at = (hh: number, mm = 0) => new Date(Date.UTC(2026, 5, 10, hh, mm) - 5.5 * 3600_000);

describe("insideWindow", () => {
  it("includes the start and excludes the end", () => {
    expect(insideWindow(at(7), day, KOLKATA)).toBe(true);
    expect(insideWindow(at(21, 59), day, KOLKATA)).toBe(true);
    expect(insideWindow(at(22), day, KOLKATA)).toBe(false);
    expect(insideWindow(at(6, 59), day, KOLKATA)).toBe(false);
  });
  it("handles a window that crosses midnight", () => {
    expect(insideWindow(at(23, 30), night, KOLKATA)).toBe(true);
    expect(insideWindow(at(5), night, KOLKATA)).toBe(true);
    expect(insideWindow(at(12), night, KOLKATA)).toBe(false);
  });
  it("is always true with no window", () => expect(insideWindow(at(3), null, KOLKATA)).toBe(true));
});

describe("intoWindow", () => {
  it("keeps a time that is already inside", () => expect(intoWindow(at(9), day, KOLKATA)).toEqual(at(9)));
  it("moves 23:00 to 07:00 the next morning", () => {
    expect(intoWindow(at(23), day, KOLKATA).getTime()).toBe(at(7).getTime() + 24 * 3600_000);
  });
});

describe("nextCheckAt", () => {
  const now = at(9);
  it("adds the whole spread at rand = 1", () => {
    expect(nextCheckAt(now, 1440, null, KOLKATA, () => 1).getTime()).toBe(now.getTime() + (1440 + 144) * 60_000);
  });
  it("adds no spread at rand = 0", () => {
    expect(nextCheckAt(now, 1440, null, KOLKATA, () => 0).getTime()).toBe(now.getTime() + 1440 * 60_000);
  });
  it("lands inside the window across a daylight-saving change", () => {
    const ny = "America/New_York";
    const before = new Date("2026-03-07T15:00:00Z"); // 10:00 local, the day before the change
    const next = nextCheckAt(before, 1440, day, ny, () => 0.5);
    expect(insideWindow(next, day, ny)).toBe(true);
  });
});

describe("backoffMs", () => {
  it("steps 15 minutes, 1 hour, 4 hours and stays at 4 hours", () => {
    expect(backoffMs(1, 10)).toBe(900_000);
    expect(backoffMs(2, 10)).toBe(3_600_000);
    expect(backoffMs(3, 10)).toBe(14_400_000);
    expect(backoffMs(9, 10)).toBe(14_400_000);
  });
  it("is never shorter than the supplier's own pause", () => expect(backoffMs(1, 2000)).toBeGreaterThanOrEqual(2_000_000));
});

describe("isStale", () => {
  const now = new Date("2026-06-10T12:00:00Z");
  const ago = (min: number) => new Date(now.getTime() - min * 60_000);
  it("is false with no check yet or no interval", () => {
    expect(isStale(null, 1440, now)).toBe(false);
    expect(isStale(ago(99999), null, now)).toBe(false);
  });
  it("is true only past twice the interval", () => {
    expect(isStale(ago(2880), 1440, now)).toBe(false);
    expect(isStale(ago(2881), 1440, now)).toBe(true);
  });
});

describe("pickDue", () => {
  const now = at(9);
  const due = (id: string, minutesAgo: number, window: typeof day | null = null) => ({ id, nextCheckAt: new Date(now.getTime() - minutesAgo * 60_000), window });
  it("returns the oldest due first and skips ones not due or outside their window", () => {
    const list = [due("b", 10), due("a", 60), { id: "later", nextCheckAt: new Date(now.getTime() + 1000), window: null }, due("night", 5, { start: "10:00", end: "11:00" })];
    expect(pickDue(list, now, 0, 5, KOLKATA)).toEqual(["a", "b"]);
  });
  it("respects the limit on runs at once", () => {
    const list = [due("a", 60), due("b", 50), due("c", 40)];
    expect(pickDue(list, now, 0, 2, KOLKATA)).toEqual(["a", "b"]);
    expect(pickDue(list, now, 1, 2, KOLKATA)).toEqual(["a"]);
    expect(pickDue(list, now, 2, 2, KOLKATA)).toEqual([]);
  });
});

describe("runExpirySeconds", () => {
  it("allows each link its pause plus 30 seconds, never under 15 minutes or over 6 hours", () => {
    expect(runExpirySeconds(1, 10)).toBe(900);
    expect(runExpirySeconds(60, 60)).toBe(60 * 90);
    expect(runExpirySeconds(10_000, 60)).toBe(6 * 3600);
  });
});
