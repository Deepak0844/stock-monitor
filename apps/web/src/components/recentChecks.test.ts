import { describe, expect, it } from "vitest";
import type { CheckRun, RecentChecks, ScheduleRow } from "../api.js";
import { recentChecksSentence } from "./recentChecks.js";

// Local times, so the test reads the same in any time zone.
const NOW = new Date(2026, 10, 19, 9, 14); // Thursday 19 November, 09:14
const at = (d: number, h: number, m: number) => new Date(2026, 10, d, h, m).toISOString();
const ran = (endedAt: string): CheckRun => ({ id: "r", supplierId: "s", trigger: "scheduled", kind: "stock", startedAt: endedAt, endedAt, linksTotal: 1, linksDone: 1, inStock: 1, outOfStock: 0, cannotTell: 0, outcome: "finished", stopReason: null });
const none: RecentChecks = { total: 0, finished: 0, failed: 0, stopped: 0, streak: null };
const row = (over: Partial<ScheduleRow>): ScheduleRow => ({ supplierId: "s", status: { state: "waiting" }, intervalMinutes: 30, window: null, nextCheckAt: null, run: null, lastRun: null, recent: none, ...over });

describe("recentChecksSentence", () => {
  it("says when the last check was for a supplier with automatic checks off", () => {
    expect(recentChecksSentence(row({ status: { state: "off" }, intervalMinutes: null, lastRun: ran(at(16, 16, 20)) }), NOW)).toEqual({ text: "No checks since Monday (automatic checks off)", tone: "neutral" });
    expect(recentChecksSentence(row({ status: { state: "off" }, intervalMinutes: null, lastRun: ran(at(18, 10, 0)) }), NOW).text).toBe("No checks since yesterday (automatic checks off)");
    expect(recentChecksSentence(row({ status: { state: "off" }, intervalMinutes: null, lastRun: ran(at(19, 8, 5)) }), NOW).text).toBe("No checks since 08:05 (automatic checks off)");
    expect(recentChecksSentence(row({ status: { state: "off" }, intervalMinutes: null, lastRun: ran(at(2, 9, 0)) }), NOW).text).toBe("No checks since 2 Nov (automatic checks off)");
  });

  it("says automatic checks are off when there was never a check", () => {
    expect(recentChecksSentence(row({ status: { state: "off" }, intervalMinutes: null }), NOW)).toEqual({ text: "Automatic checks off", tone: "neutral" });
  });

  it("says there are no checks yet", () => {
    expect(recentChecksSentence(row({}), NOW)).toEqual({ text: "No checks yet", tone: "neutral" });
  });

  it("says how many failed and since when, and that checks stopped", () => {
    const recent = { total: 24, finished: 21, failed: 3, stopped: 0, streak: { count: 3, since: at(19, 7, 48) } };
    expect(recentChecksSentence(row({ recent, status: { state: "not_checked", reason: "needs_reconnect", message: "Reconnect" } }), NOW)).toEqual({ text: "3 failed from 07:48, then checks stopped", tone: "bad" });
    expect(recentChecksSentence(row({ recent }), NOW).text).toBe("3 failed from 07:48");
    expect(recentChecksSentence(row({ recent: { ...recent, streak: { count: 2, since: at(17, 7, 48) } } }), NOW).text).toBe("2 failed from Tue 07:48");
  });

  it("says the checks were fine", () => {
    expect(recentChecksSentence(row({ recent: { total: 24, finished: 24, failed: 0, stopped: 0, streak: null } }), NOW)).toEqual({ text: "Last 24 checks fine", tone: "ok" });
    expect(recentChecksSentence(row({ recent: { total: 1, finished: 1, failed: 0, stopped: 0, streak: null } }), NOW).text).toBe("Last check fine");
  });

  it("says how many did not finish when fine and not-fine are mixed", () => {
    expect(recentChecksSentence(row({ recent: { total: 24, finished: 23, failed: 0, stopped: 1, streak: null } }), NOW)).toEqual({ text: "23 fine, 1 didn't finish", tone: "neutral" });
  });
});
