import type { CheckRun } from "@stock-monitor/db";

/** How a supplier's recent automatic checks went, for the sentence on the Suppliers page and the Dashboard. */
export type RecentChecks = {
  /** Ended runs looked at: the newest 24 at most. */
  total: number;
  finished: number;
  failed: number;
  stopped: number;
  /** The unbroken run of failed or stopped checks at the newest end, and when the first of them started. */
  streak: { count: number; since: string } | null;
};

const LOOK_AT = 24;

/** Sums up runs given newest first. A run still going is left out. */
export function summarizeRuns(runs: CheckRun[]): RecentChecks {
  const ended = runs.filter((r) => r.outcome !== "running").slice(0, LOOK_AT);
  const count = (o: CheckRun["outcome"]) => ended.filter((r) => r.outcome === o).length;
  let streakLength = 0;
  while (streakLength < ended.length && ended[streakLength]!.outcome !== "finished") streakLength++;
  const oldest = ended[streakLength - 1];
  return {
    total: ended.length,
    finished: count("finished"),
    failed: count("failed"),
    stopped: count("stopped"),
    streak: oldest ? { count: streakLength, since: oldest.startedAt.toISOString() } : null,
  };
}
