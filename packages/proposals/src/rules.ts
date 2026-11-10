export type ProposalKind = "set_zero_out_of_stock" | "set_zero_not_listed" | "set_zero_page_missing" | "restock";

export type ProposalInput = {
  answer: "in_stock" | "out_of_stock" | "cannot_tell";
  /** The checker's reason, e.g. "not_listed" or "page_missing". */
  reason: string | null;
  quantityMismatch: boolean;
  /** What Shopify last showed at the chosen location; null when unknown. */
  shopifyQuantity: number | null;
  /** The link has been missing on two checks 6+ hours apart. */
  mayBeUnavailable: boolean;
  defaultQuantity: number;
};

export type Wanted = { kind: ProposalKind; proposedQuantity: number };

export const MAX_QUANTITY = 100_000;

/** The one change the app would suggest for a link, or null for "nothing". Never suggests from a check that could not tell, except a missing page on a link that may be unavailable. */
export function decideProposal(i: ProposalInput): Wanted | null {
  if (i.shopifyQuantity === null || i.quantityMismatch) return null;
  if (i.answer === "cannot_tell") {
    return i.reason === "page_missing" && i.mayBeUnavailable && i.shopifyQuantity > 0
      ? { kind: "set_zero_page_missing", proposedQuantity: 0 }
      : null;
  }
  if (i.answer === "out_of_stock") {
    if (i.shopifyQuantity <= 0) return null;
    return { kind: i.reason === "not_listed" ? "set_zero_not_listed" : "set_zero_out_of_stock", proposedQuantity: 0 };
  }
  return i.shopifyQuantity === 0 && i.defaultQuantity > 0 ? { kind: "restock", proposedQuantity: i.defaultQuantity } : null;
}

/** A plain reason the number is not allowed, or null when it is. */
export function validateQuantity(n: number): string | null {
  if (typeof n !== "number" || !Number.isInteger(n)) return "Enter a whole number.";
  if (n < 0) return "The number cannot be below 0.";
  if (n > MAX_QUANTITY) return `The number cannot be above ${MAX_QUANTITY}.`;
  return null;
}

export const expiresAt = (now: Date, hours: number) => new Date(now.getTime() + hours * 3_600_000);

/** True unless Shopify still shows exactly the number the suggestion was made from. */
export const isConflict = (seen: number | null, current: number | null) => seen === null || current === null || seen !== current;

const RETRY_DELAYS_MS = [10_000, 60_000, 300_000];

/** Wait before retrying after an unknown outcome (attempt 1 is the first retry), or stop. */
export const nextAfterUnknown = (attempt: number): number | "give_up" => RETRY_DELAYS_MS[attempt - 1] ?? "give_up";
