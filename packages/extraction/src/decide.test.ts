import { describe, expect, it } from "vitest";
import { decide } from "./decide.js";
import { btn, page } from "./fixtures.js";
import type { Recipe } from "./types.js";

const recipe: Recipe = {
  pageChecks: [{ type: "text", text: "Blue Tee" }],
  inStock: [{ type: "button", label: "Add to cart", enabled: true }],
  outOfStock: [{ type: "text", text: "Sold out", under: "Blue Tee" }],
};
const normal = (extra: string[] = [], buttons = [btn("Add to cart", true, "Blue Tee")]) => page([["Blue Tee", 1, ["Soft cotton.", ...extra]]], buttons);

describe("decide: stock rules", () => {
  it("in stock when only an in-stock rule matches", () => {
    expect(decide(normal(), recipe, null)).toEqual({ answer: "in_stock", reason: null, quantity: null, matchedText: "Add to cart", quantityMismatch: false });
  });
  it("out of stock when only an out-of-stock rule matches", () => {
    expect(decide(normal(["Sold out"], [btn("Add to cart", false, "Blue Tee")]), recipe, null)).toMatchObject({ answer: "out_of_stock", reason: null, matchedText: "Sold out" });
  });
  it("cannot tell when both match", () => {
    expect(decide(normal(["Sold out"]), recipe, null)).toMatchObject({ answer: "cannot_tell", reason: "both_matched" });
  });
  it("cannot tell when neither matches", () => {
    expect(decide(normal([], []), recipe, null)).toMatchObject({ answer: "cannot_tell", reason: "neither_matched" });
  });
  it("a Sold out badge on a related product does not decide this item", () => {
    const withRelated = page(
      [
        ["Blue Tee", 1, ["Soft cotton."]],
        ["You may also like", 1, ["Red Tee", "Sold out"]],
      ],
      [btn("Add to cart", true, "Blue Tee")],
    );
    expect(decide(withRelated, recipe, null)).toMatchObject({ answer: "in_stock" });
  });
});

describe("decide: the page check", () => {
  it("a page that no longer passes its page check is cannot tell, never out of stock", () => {
    const changed = page([["Something new", 1, ["Sold out"]]]);
    expect(decide(changed, recipe, null)).toMatchObject({ answer: "cannot_tell", reason: "page_changed", matchedText: null });
  });
  it("every page check must pass", () => {
    const two: Recipe = { ...recipe, pageChecks: [...recipe.pageChecks, { type: "button", label: "Wishlist" }] };
    expect(decide(normal(), two, null)).toMatchObject({ answer: "cannot_tell", reason: "page_changed" });
  });
});

describe("decide: quantity", () => {
  const withQuantity: Recipe = { ...recipe, quantity: { label: "Units left" } };
  it("reads the quantity beside an in-stock answer", () => {
    expect(decide(normal(["Units left 12"]), withQuantity, null)).toMatchObject({ answer: "in_stock", quantity: 12, quantityMismatch: false });
  });
  it("quantity 0 against an in-stock button is cannot tell and flagged", () => {
    expect(decide(normal(["Units left 0"]), withQuantity, null)).toMatchObject({ answer: "cannot_tell", reason: "quantity_text_disagree", quantity: 0, quantityMismatch: true });
  });
  it("a quantity above 0 against an out-of-stock text is cannot tell and flagged", () => {
    expect(decide(normal(["Sold out", "Units left 5"], []), withQuantity, null)).toMatchObject({ answer: "cannot_tell", reason: "quantity_text_disagree", quantity: 5, quantityMismatch: true });
  });
  it("decides by the quantity alone when no text rule matches", () => {
    expect(decide(normal(["Units left 4"], []), withQuantity, null)).toMatchObject({ answer: "in_stock", quantity: 4 });
    expect(decide(normal(["Units left 0"], []), withQuantity, null)).toMatchObject({ answer: "out_of_stock", quantity: 0 });
  });
  it("is fine without a quantity on the page", () => {
    expect(decide(normal(), withQuantity, null)).toMatchObject({ answer: "in_stock", quantity: null });
  });
});

describe("decide: region", () => {
  const regional: Recipe = { pageChecks: [{ type: "text", text: "Blue Tee" }], inStock: [], outOfStock: [], region: { under: "Click & Collect Availability" } };
  const withTable = (rows: string[]) => page([["Blue Tee", 1, ["Soft cotton."]], ["Click & Collect Availability", 2, rows]]);
  const rows = ["Loughborough\t46", "Sheffield\t22", "Cardiff\t0"];

  it("a listed region with a number above 0 is in stock with that quantity", () => {
    expect(decide(withTable(rows), regional, "Loughborough")).toEqual({ answer: "in_stock", reason: null, quantity: 46, matchedText: "Loughborough\t46", quantityMismatch: false });
  });
  it("a listed region with 0 is out of stock", () => {
    expect(decide(withTable(rows), regional, "Cardiff")).toMatchObject({ answer: "out_of_stock", reason: null, quantity: 0 });
  });
  it("a region missing while the rest of the table is there is out of stock, not listed", () => {
    expect(decide(withTable(rows), regional, "Manchester")).toMatchObject({ answer: "out_of_stock", reason: "not_listed", quantity: null });
  });
  it("a region missing and the whole table gone is cannot tell, never out of stock", () => {
    expect(decide(page([["Blue Tee", 1, ["Soft cotton."]]]), regional, "Manchester")).toMatchObject({ answer: "cannot_tell", reason: "page_changed" });
  });
  it("a renamed table heading is the same: cannot tell", () => {
    const renamed = page([["Blue Tee", 1, []], ["Pick up in store", 2, rows]]);
    expect(decide(renamed, regional, "Manchester")).toMatchObject({ answer: "cannot_tell", reason: "page_changed" });
  });
  it("a label with no number is cannot tell", () => {
    expect(decide(withTable([...rows, "Preston\tOut of stock"]), regional, "Preston")).toMatchObject({ answer: "cannot_tell", reason: "neither_matched" });
  });
  it("the page check still comes first", () => {
    expect(decide(page([["Click & Collect Availability", 2, rows]]), regional, "Loughborough")).toMatchObject({ answer: "cannot_tell", reason: "page_changed" });
  });
  it("with no region chosen, the region rule is ignored and the stock rules decide", () => {
    expect(decide(withTable(rows), { ...regional, inStock: [{ type: "text", text: "Soft cotton" }] }, null)).toMatchObject({ answer: "in_stock" });
  });
});

describe("decide", () => {
  it("gives the same answer for the same page, every time", () => {
    const p = normal();
    expect(decide(p, recipe, null)).toEqual(decide(p, recipe, null));
  });
});
