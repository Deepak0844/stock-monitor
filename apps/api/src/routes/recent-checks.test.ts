import { describe, expect, it } from "vitest";
import type { CheckRun } from "@stock-monitor/db";
import { summarizeRuns } from "./recent-checks.js";

let n = 0;
const run = (outcome: CheckRun["outcome"], startedAt: string): CheckRun => ({
  id: `r${++n}`,
  supplierId: "s1",
  trigger: "scheduled",
  kind: "stock",
  startedAt: new Date(startedAt),
  endedAt: outcome === "running" ? null : new Date(new Date(startedAt).getTime() + 60_000),
  linksTotal: 10,
  linksDone: 10,
  inStock: 8,
  outOfStock: 2,
  cannotTell: 0,
  outcome,
  stopReason: null,
});

// Runs arrive newest first, as checkRuns.recent gives them.
describe("summarizeRuns", () => {
  it("is all zeros with no runs", () => {
    expect(summarizeRuns([])).toEqual({ total: 0, finished: 0, failed: 0, stopped: 0, streak: null });
  });

  it("counts 24 finished runs with no streak", () => {
    const runs = Array.from({ length: 24 }, (_, i) => run("finished", `2026-11-19T0${Math.floor(i / 10)}:${String((i % 10) * 5).padStart(2, "0")}:00Z`));
    expect(summarizeRuns(runs)).toEqual({ total: 24, finished: 24, failed: 0, stopped: 0, streak: null });
  });

  it("finds the failure streak at the newest end and when it began", () => {
    const runs = [run("failed", "2026-11-19T08:28:00Z"), run("failed", "2026-11-19T08:08:00Z"), run("stopped", "2026-11-19T07:48:00Z"), run("finished", "2026-11-19T07:28:00Z"), run("failed", "2026-11-19T07:08:00Z")];
    expect(summarizeRuns(runs)).toEqual({ total: 5, finished: 1, failed: 3, stopped: 1, streak: { count: 3, since: "2026-11-19T07:48:00.000Z" } });
  });

  it("leaves out a run that is still going", () => {
    const runs = [run("running", "2026-11-19T09:00:00Z"), run("finished", "2026-11-19T08:00:00Z")];
    expect(summarizeRuns(runs)).toEqual({ total: 1, finished: 1, failed: 0, stopped: 0, streak: null });
  });

  it("looks at the newest 24 ended runs only", () => {
    const runs = Array.from({ length: 30 }, (_, i) => run(i >= 24 ? "failed" : "finished", new Date(Date.UTC(2026, 10, 19, 23 - Math.floor(i / 2), (i % 2) * 30)).toISOString()));
    expect(summarizeRuns(runs)).toMatchObject({ total: 24, finished: 24, failed: 0 });
  });
});
