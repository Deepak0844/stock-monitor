import type { ScheduleRow } from "../api.js";

export type CheckStatusSummary = { on: boolean; nextAt: string | null; stopped: number };

/** Whether any automatic checks are on, when the next one is, and how many suppliers are not being checked right now. */
export function checkStatusOf(rows: ScheduleRow[]): CheckStatusSummary {
  const on = rows.filter((r) => r.intervalMinutes !== null);
  const next =
    on
      .map((r) => r.nextCheckAt)
      .filter((t): t is string => t !== null)
      .sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null;
  return {
    on: on.length > 0,
    nextAt: next,
    stopped: rows.filter((r) => r.status.state === "not_checked").length,
  };
}
