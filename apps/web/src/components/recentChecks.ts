import type { ScheduleRow } from "../api.js";

export type RecentSentence = { text: string; tone: "ok" | "bad" | "neutral" };

const DAY_MS = 86_400_000;
const clock = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** When something happened, as short words: "08:05" today, "yesterday", "Monday" within a week, else "2 Nov". */
function when(iso: string, now: Date): string {
  const d = new Date(iso);
  const daysAgo = Math.round((startOfDay(now) - startOfDay(d)) / DAY_MS);
  if (daysAgo <= 0) return clock(d);
  if (daysAgo === 1) return "yesterday";
  if (daysAgo < 7) return d.toLocaleDateString("en-GB", { weekday: "long" });
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** A time, with a short day in front unless it was today: "07:48" or "Tue 07:48". */
function since(iso: string, now: Date): string {
  const d = new Date(iso);
  return startOfDay(d) === startOfDay(now) ? clock(d) : `${d.toLocaleDateString("en-GB", { weekday: "short" })} ${clock(d)}`;
}

/** One sentence about a supplier's recent automatic checks. Words only: check history is never drawn as a strip. */
export function recentChecksSentence(row: ScheduleRow, now: Date): RecentSentence {
  const { recent, status, lastRun } = row;
  if (status.state === "off") {
    const ended = lastRun?.endedAt;
    return { text: ended ? `No checks since ${when(ended, now)} (automatic checks off)` : "Automatic checks off", tone: "neutral" };
  }
  if (recent.total === 0) return { text: "No checks yet", tone: "neutral" };
  if (recent.streak) {
    const stopped = status.state === "not_checked" ? ", then checks stopped" : "";
    return { text: `${recent.streak.count} failed from ${since(recent.streak.since, now)}${stopped}`, tone: "bad" };
  }
  if (recent.finished === recent.total) return { text: recent.total === 1 ? "Last check fine" : `Last ${recent.total} checks fine`, tone: "ok" };
  return { text: `${recent.finished} fine, ${recent.total - recent.finished} didn't finish`, tone: "neutral" };
}
