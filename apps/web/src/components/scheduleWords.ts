import type { CheckRun } from "../api.js";
import { formatWhen } from "../format.js";

/** The choices for how often, in the owner's words. null is off. */
export const INTERVAL_CHOICES: { minutes: number | null; words: string }[] = [
  { minutes: null, words: "Off" },
  { minutes: 60, words: "Every hour" },
  { minutes: 180, words: "Every 3 hours" },
  { minutes: 360, words: "Every 6 hours" },
  { minutes: 720, words: "Every 12 hours" },
  { minutes: 1440, words: "Every day" },
];

export const intervalWords = (minutes: number | null): string => (minutes === null ? "Automatic checks off" : (INTERVAL_CHOICES.find((c) => c.minutes === minutes)?.words ?? `Every ${minutes} minutes`));

export const whenWords = (iso: string | null): string => (iso ? formatWhen(iso) : "");

const STOP_WORDS: Record<string, string> = {
  login_required: "The supplier asked you to log in again.",
  captcha: "The supplier showed a puzzle (CAPTCHA).",
  blocked: "The supplier refused the automatic check.",
  unreachable: "The supplier could not be reached.",
  supplier_not_ready: "The supplier was paused or no longer allowed.",
  restarted: "The app restarted.",
  expired: "The run took too long and was stopped.",
};

const links = (n: number) => `${n} ${n === 1 ? "link" : "links"}`;

/** One plain sentence about a run: how far it is, how it went, or why it stopped. */
export function runSummary(run: CheckRun): string {
  switch (run.outcome) {
    case "running":
      return `Checking ${run.linksDone} of ${links(run.linksTotal)}`;
    case "finished":
      return `Checked ${links(run.linksDone)}${run.cannotTell > 0 ? `, ${run.cannotTell} cannot tell` : ""}`;
    case "stopped":
      return `Stopped after ${run.linksDone} of ${links(run.linksTotal)}. ${STOP_WORDS[run.stopReason ?? ""] ?? "It was stopped."}`;
    case "failed":
      return run.stopReason === "not_queued" ? "The check could not be started." : "The check failed. It will be tried again later.";
  }
}
