import { describe, expect, it } from "vitest";
import { decide, NO_LINK } from "./decide.js";
import { btn, page } from "./fixtures.js";
import type { Offer } from "./built-in.js";
import type { Recipe } from "./types.js";

const recipe: Recipe = {
  pageChecks: [{ type: "text", text: "Blue Tee" }],
  inStock: [{ type: "button", label: "Add to cart", enabled: true }],
  outOfStock: [{ type: "text", text: "Sold out", under: "Blue Tee" }],
};
const normal = (extra: string[] = [], buttons = [btn("Add to cart", true, "Blue Tee")]) => page([["Blue Tee", 1, ["Soft cotton.", ...extra]]], buttons);

describe("decide: stock rules", () => {
  it("in stock when only an in-stock rule matches", () => {
    expect(decide(normal(), recipe, null, NO_LINK)).toEqual({ answer: "in_stock", reason: null, quantity: null, matchedText: "Add to cart", quantityMismatch: false, decidedBy: "rules" });
  });
  it("out of stock when only an out-of-stock rule matches", () => {
    expect(decide(normal(["Sold out"], [btn("Add to cart", false, "Blue Tee")]), recipe, null, NO_LINK)).toMatchObject({ answer: "out_of_stock", reason: null, matchedText: "Sold out" });
  });
  it("cannot tell when both match", () => {
    expect(decide(normal(["Sold out"]), recipe, null, NO_LINK)).toMatchObject({ answer: "cannot_tell", reason: "both_matched" });
  });
  it("cannot tell when neither matches", () => {
    expect(decide(normal([], []), recipe, null, NO_LINK)).toMatchObject({ answer: "cannot_tell", reason: "neither_matched" });
  });
  it("a Sold out badge on a related product does not decide this item", () => {
    const withRelated = page(
      [
        ["Blue Tee", 1, ["Soft cotton."]],
        ["You may also like", 1, ["Red Tee", "Sold out"]],
      ],
      [btn("Add to cart", true, "Blue Tee")],
    );
    expect(decide(withRelated, recipe, null, NO_LINK)).toMatchObject({ answer: "in_stock" });
  });
});

describe("decide: the page check", () => {
  it("a page that no longer passes its page check is cannot tell, never out of stock", () => {
    const changed = page([["Something new", 1, ["Sold out"]]]);
    expect(decide(changed, recipe, null, NO_LINK)).toMatchObject({ answer: "cannot_tell", reason: "page_changed", matchedText: null });
  });
  it("every page check must pass", () => {
    const two: Recipe = { ...recipe, pageChecks: [...recipe.pageChecks, { type: "button", label: "Wishlist" }] };
    expect(decide(normal(), two, null, NO_LINK)).toMatchObject({ answer: "cannot_tell", reason: "page_changed" });
  });
});

describe("decide: quantity", () => {
  const withQuantity: Recipe = { ...recipe, quantity: { label: "Units left" } };
  it("reads the quantity beside an in-stock answer", () => {
    expect(decide(normal(["Units left 12"]), withQuantity, null, NO_LINK)).toMatchObject({ answer: "in_stock", quantity: 12, quantityMismatch: false });
  });
  it("quantity 0 against an in-stock button is cannot tell and flagged", () => {
    expect(decide(normal(["Units left 0"]), withQuantity, null, NO_LINK)).toMatchObject({ answer: "cannot_tell", reason: "quantity_text_disagree", quantity: 0, quantityMismatch: true });
  });
  it("a quantity above 0 against an out-of-stock text is cannot tell and flagged", () => {
    expect(decide(normal(["Sold out", "Units left 5"], []), withQuantity, null, NO_LINK)).toMatchObject({ answer: "cannot_tell", reason: "quantity_text_disagree", quantity: 5, quantityMismatch: true });
  });
  it("decides by the quantity alone when no text rule matches", () => {
    expect(decide(normal(["Units left 4"], []), withQuantity, null, NO_LINK)).toMatchObject({ answer: "in_stock", quantity: 4 });
    expect(decide(normal(["Units left 0"], []), withQuantity, null, NO_LINK)).toMatchObject({ answer: "out_of_stock", quantity: 0 });
  });
  it("is fine without a quantity on the page", () => {
    expect(decide(normal(), withQuantity, null, NO_LINK)).toMatchObject({ answer: "in_stock", quantity: null });
  });
});

describe("decide: region", () => {
  const regional: Recipe = { pageChecks: [{ type: "text", text: "Blue Tee" }], inStock: [], outOfStock: [], region: { under: "Click & Collect Availability" } };
  const withTable = (rows: string[]) => page([["Blue Tee", 1, ["Soft cotton."]], ["Click & Collect Availability", 2, rows]]);
  const rows = ["Loughborough\t46", "Sheffield\t22", "Cardiff\t0"];

  it("a listed region with a number above 0 is in stock with that quantity", () => {
    expect(decide(withTable(rows), regional, "Loughborough", NO_LINK)).toEqual({ answer: "in_stock", reason: null, quantity: 46, matchedText: "Loughborough\t46", quantityMismatch: false, decidedBy: null });
  });
  it("a listed region with 0 is out of stock", () => {
    expect(decide(withTable(rows), regional, "Cardiff", NO_LINK)).toMatchObject({ answer: "out_of_stock", reason: null, quantity: 0 });
  });
  it("a region missing while the rest of the table is there is out of stock, not listed", () => {
    expect(decide(withTable(rows), regional, "Manchester", NO_LINK)).toMatchObject({ answer: "out_of_stock", reason: "not_listed", quantity: null });
  });
  it("a region missing and the whole table gone is cannot tell, never out of stock", () => {
    expect(decide(page([["Blue Tee", 1, ["Soft cotton."]]]), regional, "Manchester", NO_LINK)).toMatchObject({ answer: "cannot_tell", reason: "page_changed" });
  });
  it("a renamed table heading is the same: cannot tell", () => {
    const renamed = page([["Blue Tee", 1, []], ["Pick up in store", 2, rows]]);
    expect(decide(renamed, regional, "Manchester", NO_LINK)).toMatchObject({ answer: "cannot_tell", reason: "page_changed" });
  });
  it("a label with no number is cannot tell", () => {
    expect(decide(withTable([...rows, "Preston\tOut of stock"]), regional, "Preston", NO_LINK)).toMatchObject({ answer: "cannot_tell", reason: "neither_matched" });
  });
  it("the page check still comes first", () => {
    expect(decide(page([["Click & Collect Availability", 2, rows]]), regional, "Loughborough", NO_LINK)).toMatchObject({ answer: "cannot_tell", reason: "page_changed" });
  });
  it("with no region chosen, the region rule is ignored and the stock rules decide", () => {
    expect(decide(withTable(rows), { ...regional, inStock: [{ type: "text", text: "Soft cotton" }] }, null, NO_LINK)).toMatchObject({ answer: "in_stock" });
  });
});

describe("decide", () => {
  it("gives the same answer for the same page, every time", () => {
    const p = normal();
    expect(decide(p, recipe, null, NO_LINK)).toEqual(decide(p, recipe, null, NO_LINK));
  });
});

describe("main product scope", () => {
  const page = {
    url: "https://x.test/p", title: "t", status: 200, pageClass: "ok",
    sections: [
      { heading: "Product A", level: 1, lines: ["Out of stock"] },
      { heading: "Details", level: 2, lines: ["blurb"] },
      { heading: "You may also like", level: 2, lines: [] },
      { heading: "Product B", level: 3, lines: ["10 in stock"] },
    ],
    buttons: [{ label: "Add to basket", enabled: true, section: "Product B" }],
  } as unknown as Parameters<typeof decide>[0];
  const recipe = { pageChecks: [], inStock: [{ type: "button", label: "Add to basket" }], outOfStock: [{ type: "text", text: "Out of stock" }] } as Parameters<typeof decide>[1];
  it("ignores a suggested product's button when the main product is out of stock", () => {
    expect(decide(page, recipe, null, NO_LINK).answer).toBe("out_of_stock");
  });
});

describe("decide: built-in data", () => {
  const offer = (availability: string, extra: Partial<Offer> = {}): Offer => ({ availability, url: null, sku: null, name: null, ...extra });
  const withOffers = (offers: Offer[] | undefined, lines: string[] = ["Soft cotton."]) => ({ ...page([["Blue Tee", 1, lines]]), ...(offers ? { offers } : {}) });
  const link = { url: "https://shop.example/p/blue-tee", option: null };
  const builtIn: Recipe = { pageChecks: [], inStock: [], outOfStock: [], builtIn: { waiting: "out_of_stock" } };

  it("built-in data answers first", () =>
    expect(decide(withOffers([offer("https://schema.org/OutOfStock")], ["In stock now"]), { ...builtIn, inStock: [{ type: "text", text: "In stock now" }] }, null, link)).toEqual({
      answer: "out_of_stock",
      reason: null,
      quantity: null,
      matchedText: "Built-in data: OutOfStock",
      quantityMismatch: false,
      decidedBy: "built_in",
    }));
  it("the waiting choice decides pre-order", () =>
    expect(decide(withOffers([offer("PreOrder")]), { ...builtIn, builtIn: { waiting: "in_stock" } }, null, link)).toMatchObject({ answer: "in_stock", decidedBy: "built_in" }));
  it("word rules answer when built-in data is missing", () =>
    expect(decide(withOffers(undefined, ["In stock now"]), { ...builtIn, inStock: [{ type: "text", text: "In stock now" }] }, null, link)).toMatchObject({ answer: "in_stock", decidedBy: "rules" }));
  it("word rules answer when built-in data is unclear", () =>
    expect(decide(withOffers([offer("Reserved")], ["Sold out"]), { ...builtIn, outOfStock: [{ type: "text", text: "Sold out" }] }, null, link)).toMatchObject({ answer: "out_of_stock", decidedBy: "rules" }));
  it("no data and no word rules is page_changed", () => expect(decide(withOffers(undefined), builtIn, null, link)).toMatchObject({ answer: "cannot_tell", reason: "page_changed", decidedBy: null }));
  it("unclear data and no word rules keeps its reason", () => expect(decide(withOffers([offer("Reserved")]), builtIn, null, link)).toMatchObject({ answer: "cannot_tell", reason: "built_in_unclear" }));
  it("options that differ with no match are variant_unclear", () =>
    expect(decide(withOffers([offer("InStock", { name: "Red" }), offer("OutOfStock", { name: "Blue" })]), builtIn, null, link)).toMatchObject({ answer: "cannot_tell", reason: "variant_unclear" }));
  it("the link's option picks the offer", () =>
    expect(decide(withOffers([offer("InStock", { name: "Red" }), offer("OutOfStock", { name: "Blue" })]), builtIn, null, { url: null, option: "blue" })).toMatchObject({ answer: "out_of_stock" }));
  it("failing page checks win over built-in data", () =>
    expect(decide(withOffers([offer("InStock")]), { ...builtIn, pageChecks: [{ type: "text", text: "Not on page" }] }, null, link)).toMatchObject({ answer: "cannot_tell", reason: "page_changed" }));
  it("the region rule wins over built-in data", () => {
    const p = { ...page([["Blue Tee", 1, []], ["Stores", 2, ["Hull\t0", "Leeds\t3"]]]), offers: [offer("InStock")] };
    expect(decide(p, { ...builtIn, region: { under: "Stores" } }, "Hull", link)).toMatchObject({ answer: "out_of_stock", quantity: 0, decidedBy: null });
  });
  it("built-in off ignores the offers", () =>
    expect(decide(withOffers([offer("InStock")], ["Sold out"]), { pageChecks: [{ type: "text", text: "Blue Tee" }], inStock: [], outOfStock: [{ type: "text", text: "Sold out" }] }, null, link)).toMatchObject({
      answer: "out_of_stock",
      decidedBy: "rules",
    }));
  it("an old saved page with no offers and no link does not throw", () => expect(decide(withOffers(undefined), builtIn, null, { url: null, option: null }).answer).toBe("cannot_tell"));
});
