import { describe, expect, it } from "vitest";
import { btn, page } from "./fixtures.js";
import { allPass, isSupplierWideChange, runExamples } from "./testing.js";
import type { Recipe } from "./types.js";

const recipe: Recipe = {
  pageChecks: [{ type: "text", text: "Blue Tee" }],
  inStock: [{ type: "button", label: "Add to cart", enabled: true }],
  outOfStock: [{ type: "text", text: "Sold out" }],
};
const inStockPage = page([["Blue Tee", 1, ["Soft cotton."]]], [btn("Add to cart")]);
const soldOutPage = page([["Blue Tee", 1, ["Sold out"]]], [btn("Add to cart", false)]);
const example = (id: string, expected: "in_stock" | "out_of_stock" | "cannot_tell", p = inStockPage) => ({ id, name: `Example ${id}`, expected, page: p, region: null });

describe("runExamples", () => {
  it("passes an example whose answer is the expected one", () => {
    const [r] = runExamples([example("a", "in_stock")], recipe);
    expect(r).toMatchObject({ id: "a", name: "Example a", expected: "in_stock", passed: true, got: { answer: "in_stock" } });
  });
  it("fails an example whose answer is different, and shows what the recipe said", () => {
    const [r] = runExamples([example("a", "out_of_stock")], recipe);
    expect(r).toMatchObject({ passed: false, got: { answer: "in_stock" } });
  });
  it("uses the region of each example", () => {
    const regional: Recipe = { ...recipe, region: { under: "Stores" } };
    const p = page([["Blue Tee", 1, []], ["Stores", 2, ["Hull\t5", "Bristol\t0"]]]);
    const r = runExamples([{ id: "h", name: "Hull", expected: "in_stock", page: p, region: "Hull" }, { id: "b", name: "Bristol", expected: "out_of_stock", page: p, region: "Bristol" }], regional);
    expect(r.map((x) => x.passed)).toEqual([true, true]);
  });
});

describe("allPass", () => {
  it("is true only when every example passed", () => {
    expect(allPass(runExamples([example("a", "in_stock"), example("b", "out_of_stock", soldOutPage)], recipe))).toBe(true);
    expect(allPass(runExamples([example("a", "in_stock"), example("b", "in_stock", soldOutPage)], recipe))).toBe(false);
  });
  it("is false when there are no examples, so a recipe cannot be turned on untested", () => {
    expect(allPass([])).toBe(false);
  });
});

describe("isSupplierWideChange", () => {
  const run = (changed: number, total: number) => [...Array(changed).fill("page_changed"), ...Array(total - changed).fill(null)];
  it("needs at least 5 links and at least 30% changed", () => {
    expect(isSupplierWideChange(run(2, 6))).toBe(true);
    expect(isSupplierWideChange(run(1, 5))).toBe(false);
    expect(isSupplierWideChange(run(4, 4))).toBe(false);
    expect(isSupplierWideChange(run(5, 5))).toBe(true);
  });
  it("counts only page changed, not other reasons", () => {
    expect(isSupplierWideChange(Array(6).fill("check_failed"))).toBe(false);
  });
});
