import { describe, expect, it } from "vitest";
import type { Recipe } from "../api.js";
import { diffRules, ruleLines } from "./ruleWords.js";

const a: Recipe = {
  pageChecks: [{ type: "text", text: "Blue Tee" }],
  inStock: [{ type: "button", label: "Add to basket", enabled: true }],
  outOfStock: [{ type: "text", text: "Sold out", under: "Availability" }],
};

describe("ruleLines", () => {
  it("writes each rule in words, grouped by what it decides", () => {
    expect(ruleLines(a)).toEqual({
      "Page checks": ["Text: “Blue Tee”"],
      "In stock when": ["Button: “Add to basket” (must be enabled)"],
      "Out of stock when": ["Text: “Sold out” under “Availability”"],
    });
  });

  it("includes a quantity and a region when there are some, and leaves empty groups out", () => {
    const lines = ruleLines({ pageChecks: [{ type: "text", text: "X" }], inStock: [], outOfStock: [], quantity: { label: "Units left", under: "Stock" }, region: { under: "Click and collect" } });
    expect(Object.keys(lines)).toEqual(["Page checks", "Quantity", "Region"]);
    expect(lines.Quantity).toEqual(["Number after “Units left” under “Stock”"]);
    expect(lines.Region).toEqual(["Regions listed under “Click and collect”"]);
  });
});

describe("diffRules", () => {
  it("lists what one version adds and removes compared with another", () => {
    const b: Recipe = { ...a, outOfStock: [{ type: "text", text: "Currently unavailable" }] };
    expect(diffRules(a, b)).toEqual({
      added: ["Out of stock when: Text: “Sold out” under “Availability”"],
      removed: ["Out of stock when: Text: “Currently unavailable”"],
    });
  });

  it("is empty when the rules are the same", () => {
    expect(diffRules(a, a)).toEqual({ added: [], removed: [] });
  });
});
