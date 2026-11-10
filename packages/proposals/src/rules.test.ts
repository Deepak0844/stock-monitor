import { describe, expect, it } from "vitest";
import { decideProposal, expiresAt, isConflict, MAX_QUANTITY, nextAfterUnknown, validateQuantity, type ProposalInput } from "./rules.js";

const base: ProposalInput = {
  answer: "out_of_stock",
  reason: null,
  quantityMismatch: false,
  shopifyQuantity: 4,
  mayBeUnavailable: false,
  defaultQuantity: 5,
};
const input = (over: Partial<ProposalInput>): ProposalInput => ({ ...base, ...over });

describe("decideProposal", () => {
  it("out of stock with stock in Shopify suggests 0", () => {
    expect(decideProposal(base)).toEqual({ kind: "set_zero_out_of_stock", proposedQuantity: 0 });
  });
  it("region not listed with stock in Shopify suggests 0 with its own kind", () => {
    expect(decideProposal(input({ reason: "not_listed" }))).toEqual({ kind: "set_zero_not_listed", proposedQuantity: 0 });
  });
  it("page missing suggests 0 only when the link may be unavailable", () => {
    // The checker reports a missing page as "cannot tell" with the reason page_missing.
    const missing = { answer: "cannot_tell", reason: "page_missing" } as const;
    expect(decideProposal(input({ ...missing, mayBeUnavailable: false }))).toBeNull();
    expect(decideProposal(input({ ...missing, mayBeUnavailable: true }))).toEqual({
      kind: "set_zero_page_missing",
      proposedQuantity: 0,
    });
  });
  it("in stock with 0 in Shopify suggests the default quantity", () => {
    expect(decideProposal(input({ answer: "in_stock", shopifyQuantity: 0, defaultQuantity: 7 }))).toEqual({
      kind: "restock",
      proposedQuantity: 7,
    });
  });
  it("in stock with stock in Shopify suggests nothing", () => {
    expect(decideProposal(input({ answer: "in_stock", shopifyQuantity: 3 }))).toBeNull();
  });
  it("out of stock with 0 in Shopify suggests nothing", () => {
    expect(decideProposal(input({ shopifyQuantity: 0 }))).toBeNull();
  });
  it("cannot tell never suggests, whatever Shopify shows (a missing page on a may-be-unavailable link is the one exception)", () => {
    for (const reason of ["page_changed", "both_matched", "neither_matched", "quantity_text_disagree", "check_failed", "never_worked"] as const) {
      for (const shopifyQuantity of [0, 4]) {
        expect(decideProposal(input({ answer: "cannot_tell", reason, mayBeUnavailable: true, shopifyQuantity }))).toBeNull();
      }
    }
  });
  it("a missing page suggests nothing when Shopify already shows 0", () => {
    expect(decideProposal(input({ answer: "cannot_tell", reason: "page_missing", mayBeUnavailable: true, shopifyQuantity: 0 }))).toBeNull();
  });
  it("quantity and wording disagreeing never suggests", () => {
    expect(decideProposal(input({ quantityMismatch: true }))).toBeNull();
    expect(decideProposal(input({ answer: "in_stock", shopifyQuantity: 0, quantityMismatch: true }))).toBeNull();
  });
  it("an unknown Shopify quantity suggests nothing", () => {
    expect(decideProposal(input({ shopifyQuantity: null }))).toBeNull();
    expect(decideProposal(input({ answer: "in_stock", shopifyQuantity: null }))).toBeNull();
  });
  it("a restock of 0 is never suggested", () => {
    expect(decideProposal(input({ answer: "in_stock", shopifyQuantity: 0, defaultQuantity: 0 }))).toBeNull();
  });
});

describe("validateQuantity", () => {
  it("accepts whole numbers from 0 up to the limit", () => {
    expect(validateQuantity(0)).toBeNull();
    expect(validateQuantity(12)).toBeNull();
    expect(validateQuantity(MAX_QUANTITY)).toBeNull();
  });
  it("refuses everything else with a plain reason", () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, MAX_QUANTITY + 1, "5" as unknown as number]) {
      expect(validateQuantity(bad)).toEqual(expect.any(String));
    }
  });
});

describe("expiresAt", () => {
  it("adds the hours", () => {
    expect(expiresAt(new Date("2026-06-10T00:00:00Z"), 24).toISOString()).toBe("2026-06-11T00:00:00.000Z");
  });
});

describe("isConflict", () => {
  it("is false only when Shopify still shows the number we saw", () => {
    expect(isConflict(4, 4)).toBe(false);
    expect(isConflict(4, 3)).toBe(true);
    expect(isConflict(4, null)).toBe(true);
    expect(isConflict(null, null)).toBe(true);
  });
});

describe("nextAfterUnknown", () => {
  it("retries after 10 seconds, 1 minute and 5 minutes, then gives up", () => {
    expect(nextAfterUnknown(1)).toBe(10_000);
    expect(nextAfterUnknown(2)).toBe(60_000);
    expect(nextAfterUnknown(3)).toBe(300_000);
    expect(nextAfterUnknown(4)).toBe("give_up");
  });
});
