import type { LatestStock, StockAnswer, StockReason } from "../api.js";

export const ANSWER_WORDS: Record<StockAnswer, string> = { in_stock: "In stock", out_of_stock: "Out of stock", cannot_tell: "Cannot tell" };
export const ANSWER_TONE: Record<StockAnswer, "ok" | "warn" | "neutral"> = { in_stock: "ok", out_of_stock: "warn", cannot_tell: "neutral" };

const REASON_WORDS: Record<StockReason, string> = {
  page_changed: "The page changed. Review the stock rules.",
  both_matched: "Both the in-stock and the out-of-stock rules matched.",
  neither_matched: "None of the rules matched.",
  quantity_text_disagree: "The quantity and the wording disagree.",
  not_listed: "Not listed for the region.",
  check_failed: "The check did not work: a login, a puzzle, a block, or the supplier could not be reached.",
  page_missing: "The page is missing.",
  never_worked: "This address never loaded the right page.",
};
export const reasonWords = (reason: StockReason | null): string | null => (reason ? REASON_WORDS[reason] : null);

/** What a capture's fixed failure code means, in plain words. */
const CAPTURE_FAILURES: Record<string, string> = {
  login_required: "The supplier asked for a login. Reconnect the supplier and try again.",
  captcha: "The supplier showed a puzzle (CAPTCHA).",
  blocked: "The supplier blocked the visit.",
  unreachable: "The supplier could not be reached.",
  browser_unavailable: "The browser service did not answer. Try again in a minute.",
  no_permission: "You have not recorded permission to check this supplier automatically.",
  not_connected: "The supplier is not connected.",
  paused: "The supplier is paused.",
  needs_attention: "The supplier needs your attention first.",
  link_not_found: "The link for this page was deleted.",
  session_unreadable: "The saved login could not be read. Reconnect the supplier.",
};
export const captureFailureWords = (code: string | null): string => (code && CAPTURE_FAILURES[code]) || "The page could not be captured.";

/** "In stock (12)", "Out of stock", "Out of stock: not listed for Hull". */
export function stockSentence(s: LatestStock, region?: string | null): string {
  const base = ANSWER_WORDS[s.answer];
  if (s.answer === "in_stock" && s.quantity !== null) return `${base} (${s.quantity})`;
  if (s.answer === "out_of_stock" && s.reason === "not_listed") return `${base}: not listed${region ? ` for ${region}` : ""}`;
  return base;
}
