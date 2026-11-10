import type { Proposal, ProposalKind, ProposalState } from "../api.js";

const KINDS: Record<ProposalKind, string> = {
  set_zero_out_of_stock: "Out of stock",
  set_zero_not_listed: "Not listed for the region",
  set_zero_page_missing: "Page missing",
  restock: "Back in stock",
};
export const kindWords = (kind: ProposalKind): string => KINDS[kind];

const STATES: Record<ProposalState, string> = {
  open: "Waiting for you",
  approved: "Waiting for Shopify",
  applied: "Applied",
  conflict: "Not applied: Shopify changed",
  failed: "Could not apply",
  rejected: "Rejected",
  expired: "Expired",
  replaced: "Replaced",
};
export const stateWords = (state: ProposalState): string => STATES[state];
export const stateTone = (state: ProposalState): "ok" | "warn" | "neutral" =>
  state === "applied" ? "ok" : state === "conflict" || state === "failed" ? "warn" : "neutral";

const CLOSED: Record<NonNullable<Proposal["closedReason"]>, string> = {
  could_not_tell: "The latest check could not tell.",
  no_longer_needed: "Shopify and the supplier now agree.",
  link_off: "The link was turned off or the product was removed.",
  newer_answer: "A newer check replaced it.",
};
/** Why a suggestion was closed without the owner deciding. */
export const closedWords = (reason: Proposal["closedReason"]): string | null => (reason ? CLOSED[reason] : null);

const FAILURES: Record<string, string> = {
  no_permission: "Shopify has not given this app permission to change stock.",
  refused: "Shopify refused the change.",
  unconfirmed: "The app could not confirm whether Shopify made the change. Check Shopify before trying again.",
  not_connected: "Shopify was not connected. Connect Shopify and wait for the next check.",
  no_location: "No inventory location was chosen in the Shopify settings.",
  item_gone: "The product is no longer in Shopify.",
};

/** What happened, in plain words, for a decided suggestion. Never a raw code. */
export function resultWords(state: ProposalState, code: string | null, quantity: number | null): string | null {
  if (state === "applied") return `Shopify now shows ${quantity ?? "the new number"}.`;
  if (state === "conflict") return quantity === null ? "Shopify's number changed, so nothing was changed." : `Shopify now shows ${quantity}, so nothing was changed.`;
  if (state === "failed") return (code && FAILURES[code]) || "Shopify did not accept the change.";
  return null;
}
