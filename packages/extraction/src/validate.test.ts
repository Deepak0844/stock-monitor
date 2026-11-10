import { describe, expect, it } from "vitest";
import { normaliseWords, validateRecipe } from "./validate.js";

const good = {
  pageChecks: [{ type: "text", text: "Blue Tee" }],
  inStock: [{ type: "button", label: "Add to cart", enabled: true }],
  outOfStock: [{ type: "text", text: "Sold out", under: "Blue Tee" }],
  quantity: { label: "Units left" },
  region: { under: "Click and collect availability" },
};
const refused = (input: unknown) => {
  const r = validateRecipe(input);
  if (r.ok) throw new Error("should have been refused");
  return r.message;
};

describe("validateRecipe", () => {
  it("accepts a full recipe and gives it back cleaned", () => {
    expect(validateRecipe(good)).toEqual({ ok: true, recipe: good });
  });

  it("accepts the smallest recipe: one page check and nothing else", () => {
    expect(validateRecipe({ pageChecks: [{ type: "text", text: "Add to cart" }], inStock: [], outOfStock: [] })).toMatchObject({ ok: true });
  });

  it("trims words", () => {
    const r = validateRecipe({ pageChecks: [{ type: "text", text: "  Blue Tee  " }], inStock: [], outOfStock: [] });
    expect(r.ok && r.recipe.pageChecks[0]).toEqual({ type: "text", text: "Blue Tee" });
  });

  it("needs at least one page check, so a changed page can be noticed", () => {
    expect(refused({ pageChecks: [], inStock: [], outOfStock: [] })).toMatch(/page check/i);
  });

  it.each([
    [null], ["text"], [[]], [42],
  ])("refuses %j as a recipe", (input) => {
    expect(refused(input)).toMatch(/recipe/i);
  });

  it("refuses a rule type it does not know, and extra fields", () => {
    expect(refused({ ...good, inStock: [{ type: "click", label: "Buy" }] })).toMatch(/rule type/i);
    expect(refused({ ...good, inStock: [{ type: "text", text: "x", selector: ".a" }] })).toMatch(/not allowed/i);
    expect(refused({ ...good, extra: 1 })).toMatch(/not allowed/i);
  });

  it("refuses more than 10 rules in a list", () => {
    const many = Array.from({ length: 11 }, (_, n) => ({ type: "text", text: `word ${n}` }));
    expect(refused({ ...good, inStock: many })).toMatch(/at most 10/i);
  });

  it("refuses empty, over-long and non-text words", () => {
    expect(refused({ ...good, outOfStock: [{ type: "text", text: "   " }] })).toMatch(/words/i);
    expect(refused({ ...good, outOfStock: [{ type: "text", text: "x".repeat(201) }] })).toMatch(/200/);
    expect(refused({ ...good, outOfStock: [{ type: "text", text: 5 }] })).toMatch(/words/i);
    expect(refused({ ...good, outOfStock: [{ type: "text", text: "a", under: "y".repeat(201) }] })).toMatch(/200/);
    expect(refused({ ...good, outOfStock: [{ type: "button", label: "a", enabled: "yes" }] })).toMatch(/enabled/i);
  });

  it("only allows text and button rules in the stock lists, and a label in the quantity rule", () => {
    expect(refused({ ...good, inStock: [{ type: "labelled_number", label: "Units" }] })).toMatch(/rule type/i);
    expect(refused({ ...good, quantity: {} })).toMatch(/quantity/i);
    expect(refused({ ...good, region: {} })).toMatch(/region/i);
  });

  it("keeps pattern characters as plain words, never as a pattern", () => {
    const r = validateRecipe({ pageChecks: [{ type: "text", text: ".*(a+)+$" }], inStock: [], outOfStock: [] });
    expect(r.ok && r.recipe.pageChecks[0]).toEqual({ type: "text", text: ".*(a+)+$" });
  });
});

describe("normaliseWords", () => {
  it("ignores capitals, extra spaces and non-breaking spaces", () => {
    expect(normaliseWords("Sold  OUT ")).toBe("sold out");
    expect(normaliseWords("  Click   &\tCollect ")).toBe("click & collect");
  });
});
