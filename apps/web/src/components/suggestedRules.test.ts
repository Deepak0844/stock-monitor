import { describe, expect, it } from "vitest";
import type { Suggestion } from "../api.js";
import { emptyDraft } from "./RuleEditor.js";
import { addSuggested, evidenceWords } from "./suggestedRules.js";

const s = (over: Partial<Suggestion>): Suggestion => ({
  kind: "outOfStock", rule: { type: "text", text: "Sold out" }, seenOn: 3, ofTotal: 3, seenOnOther: 0, otherTotal: 4, starter: true, checked: true, ...over,
});

describe("addSuggested", () => {
  it("puts each rule in its own list and replaces the empty starter row", () => {
    const draft = addSuggested(emptyDraft(), [
      s({}),
      s({ kind: "inStock", rule: { type: "button", label: "Add to cart", enabled: true } }),
      s({ kind: "pageCheck", rule: { type: "text", text: "Product code" } }),
    ]);
    expect(draft.outOfStock).toEqual([{ type: "text", words: "Sold out", enabled: "", under: "" }]);
    expect(draft.inStock).toEqual([{ type: "button", words: "Add to cart", enabled: "true", under: "" }]);
    expect(draft.pageChecks).toEqual([{ type: "text", words: "Product code", enabled: "", under: "" }]);
  });

  it("skips a rule that is already there, whatever its case or spacing", () => {
    const start = addSuggested(emptyDraft(), [s({})]);
    const again = addSuggested(start, [s({ rule: { type: "text", text: "  sold   OUT " } })]);
    expect(again.outOfStock).toHaveLength(1);
  });

  it("keeps the rows already typed and leaves lists with nothing added alone", () => {
    const start = { ...emptyDraft(), pageChecks: [{ type: "text" as const, words: "Blue Tee", enabled: "" as const, under: "" }] };
    const draft = addSuggested(start, [s({})]);
    expect(draft.pageChecks).toEqual(start.pageChecks);
    expect(draft.outOfStock).toHaveLength(1);
  });

  it("keeps the empty row when nothing was added to its list", () => {
    expect(addSuggested(emptyDraft(), [s({})]).pageChecks).toHaveLength(1);
  });
});

describe("evidenceWords", () => {
  it("says how many pages of each answer have it", () => {
    expect(evidenceWords(s({}))).toBe("On 3 of 3 out of stock pages and 0 of 4 in stock pages.");
    expect(evidenceWords(s({ kind: "inStock", seenOn: 1, ofTotal: 1, otherTotal: 1 }))).toBe("On 1 of 1 in stock page and 0 of 1 out of stock page.");
  });
  it("says a page check is on every labelled page", () => {
    expect(evidenceWords(s({ kind: "pageCheck", seenOn: 7, ofTotal: 7, otherTotal: 0 }))).toBe("On all 7 labelled pages.");
  });
});
