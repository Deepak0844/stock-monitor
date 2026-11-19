import { describe, expect, it } from "vitest";
import { btn, page } from "./fixtures.js";
import { suggestRules, type Suggestion } from "./suggest.js";
import type { Example } from "./testing.js";
import type { Answer, PageDescription } from "./types.js";

const ex = (id: string, expected: Answer, p: PageDescription): Example => ({ id, name: id, expected, page: p, region: null });
const product = (lines: string[], buttons: PageDescription["buttons"] = []) => page([["Blue Tee", 1, lines]], buttons);
const inStock = (extra: string[] = []) => ex("in", "in_stock", product(["Soft cotton.", ...extra], [btn("Add to cart", true, "Blue Tee")]));
const outOfStock = (extra: string[] = ["Sold out"]) => ex("out", "out_of_stock", product(["Soft cotton.", ...extra], [btn("Add to cart", false, "Blue Tee")]));
const ok = (examples: Example[]) => {
  const r = suggestRules(examples);
  if (!r.ok) throw new Error(`not ok: ${r.reason}`);
  return r;
};
const of = (list: Suggestion[], kind: Suggestion["kind"]) => list.filter((s) => s.kind === kind);
const words = (s: Suggestion) => (s.rule.type === "text" ? s.rule.text : s.rule.label);

describe("suggestRules", () => {
  it("needs one page of each answer", () => {
    expect(suggestRules([inStock()])).toEqual({ ok: false, reason: "need_both_answers" });
    expect(suggestRules([inStock(), ex("c", "cannot_tell", product(["x"]))])).toEqual({ ok: false, reason: "need_both_answers" });
    expect(suggestRules([])).toEqual({ ok: false, reason: "need_both_answers" });
  });

  it("suggests the disabled button and Sold out text for out of stock, and the enabled button for in stock", () => {
    const r = ok([inStock(), outOfStock()]);
    expect(of(r.suggestions, "outOfStock")).toContainEqual({
      kind: "outOfStock", rule: { type: "text", text: "Sold out" }, seenOn: 1, ofTotal: 1, seenOnOther: 0, otherTotal: 1, starter: true, checked: true,
    });
    expect(of(r.suggestions, "outOfStock").map((s) => s.rule)).toContainEqual({ type: "button", label: "Add to cart", enabled: false });
    expect(of(r.suggestions, "inStock").map((s) => s.rule)).toContainEqual({ type: "button", label: "Add to cart", enabled: true });
    expect(r.passes).toBe(true);
  });

  it("a Sold out badge on a related product does not stop Sold out being suggested, and is never itself a candidate", () => {
    const withRelated = ex("in", "in_stock", page([["Blue Tee", 1, ["Soft cotton."]], ["You may also like", 1, ["Red Tee", "Sold out"]]], [btn("Add to cart", true, "Blue Tee")]));
    const r = ok([withRelated, outOfStock()]);
    expect(of(r.suggestions, "outOfStock")).toContainEqual(expect.objectContaining({ rule: { type: "text", text: "Sold out" }, seenOnOther: 0 }));
    expect(r.suggestions.map(words)).not.toContain("Red Tee");
    expect(r.passes).toBe(true);
  });

  it("never suggests a line seen on both sides as a stock rule", () => {
    const r = ok([inStock(["Free delivery"]), outOfStock(["Sold out", "Free delivery"])]);
    const stock = r.suggestions.filter((s) => s.kind !== "pageCheck").map(words);
    expect(stock).not.toContain("Free delivery");
    expect(stock).not.toContain("Soft cotton.");
  });

  it("suggests both wordings when out-of-stock pages differ", () => {
    const a = ex("a", "out_of_stock", product(["Soft cotton.", "Sold out"]));
    const b = ex("b", "out_of_stock", product(["Soft cotton.", "Currently unavailable"]));
    const r = ok([inStock(), a, b]);
    const out = of(r.suggestions, "outOfStock");
    expect(out).toContainEqual(expect.objectContaining({ rule: { type: "text", text: "Sold out" }, seenOn: 1, ofTotal: 2, checked: true }));
    expect(out).toContainEqual(expect.objectContaining({ rule: { type: "text", text: "Currently unavailable" }, seenOn: 1, ofTotal: 2, checked: true }));
    expect(r.passes).toBe(true);
  });

  it("skips prices, dates, numbers and long lines", () => {
    const long = "x".repeat(81);
    const r = ok([inStock(), outOfStock(["Sold out", "£12.99", "Back 12/03/2026", "42", long])]);
    const all = r.suggestions.map(words);
    expect(all).toContain("Sold out");
    for (const bad of ["£12.99", "Back 12/03/2026", "42", long]) expect(all).not.toContain(bad);
  });

  it("page checks are lines on every labelled page, not the product title", () => {
    const r = ok([inStock(["Product code"]), outOfStock(["Sold out", "Product code"])]);
    const checks = of(r.suggestions, "pageCheck");
    expect(checks.map((s) => s.rule)).toContainEqual({ type: "text", text: "Product code" });
    expect(checks.map(words)).not.toContain("Blue Tee");
    expect(checks.map(words)).not.toContain("Sold out");
    expect(checks.every((s) => s.ofTotal === 2 && s.seenOn === 2)).toBe(true);
  });

  it("caps each kind at 5, starter phrases first, then shorter lines", () => {
    const notes = Array.from({ length: 8 }, (_, i) => `Note ${"x".repeat(i + 1)}`);
    const r = ok([inStock(), outOfStock(["Sold out", ...notes])]);
    const out = of(r.suggestions, "outOfStock");
    expect(out).toHaveLength(5);
    expect(out.slice(0, 4).map(words)).toEqual(["Sold out", "Note x", "Note xx", "Note xxx"]);
  });

  it("ignores a cannot_tell page for suggestions but counts it in passes", () => {
    const base = [inStock(), outOfStock()];
    // Only Sold out and a disabled button: the ticked rules say out of stock, the owner said cannot tell.
    const odd = ex("odd", "cannot_tell", product(["Soft cotton.", "Sold out"], [btn("Add to cart", false, "Blue Tee")]));
    const plain = ok(base);
    const withOdd = ok([...base, odd]);
    expect(withOdd.suggestions).toEqual(plain.suggestions);
    expect(plain.passes).toBe(true);
    expect(withOdd.passes).toBe(false);
  });
});
