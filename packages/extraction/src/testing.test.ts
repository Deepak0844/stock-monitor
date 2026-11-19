import { describe, expect, it } from "vitest";
import { btn, page } from "./fixtures.js";
import { allPass, hasBothAnswers, isSupplierWideChange, runExamples } from "./testing.js";
import type { Decision, Recipe } from "./types.js";

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
    expect(allPass(runExamples([example("a", "in_stock"), example("b", "out_of_stock", soldOutPage)], recipe), recipe)).toBe(true);
    expect(allPass(runExamples([example("a", "in_stock"), example("b", "in_stock", soldOutPage)], recipe), recipe)).toBe(false);
  });
  it("is false when there are no examples, so a recipe cannot be turned on untested", () => {
    expect(allPass([], recipe)).toBe(false);
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

describe("built-in data in the example test", () => {
  const builtInRecipe: Recipe = { pageChecks: [], inStock: [], outOfStock: [], builtIn: { waiting: "out_of_stock" } };
  const result = (expected: "in_stock" | "out_of_stock") => ({ id: expected, name: expected, expected, got: { answer: expected } as Decision, passed: true });
  it("built-in versions need an in-stock and an out-of-stock example", () => {
    expect(allPass([result("in_stock")], builtInRecipe)).toBe(false);
    expect(allPass([result("in_stock"), result("out_of_stock")], builtInRecipe)).toBe(true);
    expect(allPass([result("in_stock")], recipe)).toBe(true);
  });
  it("hasBothAnswers looks at the expected answers", () => {
    expect(hasBothAnswers([result("in_stock"), result("out_of_stock")])).toBe(true);
    expect(hasBothAnswers([result("out_of_stock")])).toBe(false);
  });
  it("passes each example's link to decide", () => {
    const offers = [
      { availability: "InStock", url: "/p/blue-tee?variant=1", sku: null, name: null },
      { availability: "OutOfStock", url: "/p/blue-tee?variant=2", sku: null, name: null },
    ];
    const p = { ...page([["Blue Tee", 1, []]]), offers };
    const [r] = runExamples([{ id: "v", name: "Variant 2", expected: "out_of_stock", page: p, region: null, link: { url: "https://shop.example/p/blue-tee?variant=2", option: null } }], builtInRecipe);
    expect(r).toMatchObject({ passed: true, got: { decidedBy: "built_in" } });
  });
});
