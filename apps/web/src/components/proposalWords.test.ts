import { describe, expect, it } from "vitest";
import { closedWords, kindWords, resultWords, stateWords, suggestionLine } from "./proposalWords.js";

describe("proposal words", () => {
  it("names each kind of suggestion", () => {
    expect(kindWords("set_zero_out_of_stock")).toBe("Out of stock");
    expect(kindWords("set_zero_not_listed")).toBe("Not listed for the region");
    expect(kindWords("set_zero_page_missing")).toBe("Page missing");
    expect(kindWords("restock")).toBe("Back in stock");
  });

  it("names each state in plain words", () => {
    expect(stateWords("open")).toBe("Waiting for you");
    expect(stateWords("approved")).toBe("Waiting for Shopify");
    expect(stateWords("applied")).toBe("Applied");
    expect(stateWords("conflict")).toBe("Not applied: Shopify changed");
    expect(stateWords("failed")).toBe("Could not apply");
    expect(stateWords("rejected")).toBe("Rejected");
    expect(stateWords("expired")).toBe("Expired");
    expect(stateWords("replaced")).toBe("Replaced");
  });

  it("explains why a suggestion was closed without a decision", () => {
    expect(closedWords("could_not_tell")).toBe("The latest check could not tell.");
    expect(closedWords("no_longer_needed")).toBe("Shopify and the supplier now agree.");
    expect(closedWords("link_off")).toBe("The link was turned off or the product was removed.");
    expect(closedWords("newer_answer")).toBe("A newer check replaced it.");
    expect(closedWords(null)).toBeNull();
  });

  it("explains a failed or conflicting result, and never shows a raw code", () => {
    expect(resultWords("failed", "no_permission", null)).toMatch(/permission/);
    expect(resultWords("failed", "refused", null)).toMatch(/refused/);
    expect(resultWords("failed", "unconfirmed", null)).toMatch(/Check Shopify/);
    expect(resultWords("failed", "not_connected", null)).toMatch(/Connect Shopify/);
    expect(resultWords("failed", "item_gone", null)).toMatch(/no longer/);
    expect(resultWords("failed", "something_new", null)).toBe("Shopify did not accept the change.");
    expect(resultWords("conflict", "changed", 3)).toBe("Shopify now shows 3, so nothing was changed.");
    expect(resultWords("conflict", "changed", null)).toBe("Shopify's number changed, so nothing was changed.");
    expect(resultWords("applied", "applied", 0)).toBe("Shopify now shows 0.");
    expect(resultWords("open", null, null)).toBeNull();
  });

  it("puts a link's latest suggestion in one short line", () => {
    expect(suggestionLine("set_zero_out_of_stock", "open")).toBe("Suggestion: Out of stock, waiting for you");
    expect(suggestionLine("restock", "conflict")).toBe("Suggestion: Back in stock, not applied: Shopify changed");
  });
});
