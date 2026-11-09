import { describe, expect, it } from "vitest";
import { btn, page } from "./fixtures.js";
import { buttonMatches, labelledNumber, regionTable, textMatches } from "./evaluate.js";

const product = page(
  [
    [null, 0, ["Blue Tee", "£12.00"]],
    ["Blue Tee", 1, ["Soft cotton.", "Sold out"]],
    ["You may also like", 1, ["Red Tee", "Sold out"]],
  ],
  [btn("Add to cart", false, "Blue Tee"), btn("Notify me", true, "You may also like")],
);

describe("textMatches", () => {
  it("finds words ignoring capitals and spaces, and returns the line", () => {
    expect(textMatches(product, { type: "text", text: "SOLD  out" })).toBe("Sold out");
  });
  it("finds nothing when the words are not there", () => {
    expect(textMatches(product, { type: "text", text: "In stock" })).toBeNull();
  });
  it("only looks under the heading when asked, including sub-headings, up to the next heading of the same level", () => {
    const related = page([
      ["Blue Tee", 1, ["Soft cotton."]],
      ["You may also like", 1, ["Sold out"]],
    ]);
    expect(textMatches(related, { type: "text", text: "sold out" })).toBe("Sold out"); // not scoped: matches the related product
    expect(textMatches(related, { type: "text", text: "sold out", under: "blue tee" })).toBeNull(); // scoped: ignored
    expect(textMatches(related, { type: "text", text: "sold out", under: "you may also like" })).toBe("Sold out");
  });
  it("a sub-heading belongs to the section above it", () => {
    const nested = page([
      ["Blue Tee", 1, ["a"]],
      ["Delivery", 2, ["Sold out"]],
      ["Other", 1, ["x"]],
    ]);
    expect(textMatches(nested, { type: "text", text: "sold out", under: "blue tee" })).toBe("Sold out");
  });
  it("matches a heading the owner wrote loosely (the heading contains the words)", () => {
    const p = page([["Click & Collect Availability", 2, ["Hull\t15"]]]);
    expect(textMatches(p, { type: "text", text: "hull", under: "collect availability" })).toBe("Hull\t15");
  });
  it("a heading that is not on the page matches nothing", () => {
    expect(textMatches(product, { type: "text", text: "sold out", under: "no such heading" })).toBeNull();
  });
});

describe("buttonMatches", () => {
  it("finds a button by label", () => {
    expect(buttonMatches(product, { type: "button", label: "add to cart" })).toBe("Add to cart");
  });
  it("a disabled button does not match a rule that asks for enabled, and does match one that asks for disabled", () => {
    expect(buttonMatches(product, { type: "button", label: "Add to cart", enabled: true })).toBeNull();
    expect(buttonMatches(product, { type: "button", label: "Add to cart", enabled: false })).toBe("Add to cart");
  });
  it("can be limited to the buttons under a heading", () => {
    expect(buttonMatches(product, { type: "button", label: "Notify me", under: "Blue Tee" })).toBeNull();
    expect(buttonMatches(product, { type: "button", label: "Notify me", under: "You may also like" })).toBe("Notify me");
  });
});

const table = page([
  ["Click & Collect Availability", 2, ["Loughborough\t46", "Sheffield\t22", "Bristol North\t9", "Bristol\t48", "Hull", "15", "Glasgow: 1,204", "Cardiff 0", "Preston\tOut of stock"]],
]);

describe("labelledNumber", () => {
  const read = (label: string, under?: string) => labelledNumber(table, label, under);
  it("reads the number in the same row", () => expect(read("Loughborough")).toMatchObject({ found: true, quantity: 46 }));
  it("reads a number on the next line", () => expect(read("Hull")).toMatchObject({ found: true, quantity: 15 }));
  it("reads colons, commas and a zero", () => {
    expect(read("Glasgow")).toMatchObject({ quantity: 1204 });
    expect(read("Cardiff")).toMatchObject({ quantity: 0 });
  });
  it("does not mix up a label that starts another label", () => expect(read("Bristol")).toMatchObject({ quantity: 48 }));
  it("finds the label but no number when the row says something else", () => expect(read("Preston")).toEqual({ found: true, quantity: null, line: "Preston\tOut of stock" }));
  it("says not found when the label is not there", () => expect(read("Manchester")).toEqual({ found: false }));
  it("uses the first match under the heading when the label appears twice", () => {
    const twice = page([["Stores", 2, ["Hull\t5", "Hull\t9"]]]);
    expect(labelledNumber(twice, "Hull", "Stores")).toMatchObject({ quantity: 5 });
  });
  it("only looks under the heading when asked", () => expect(read("Loughborough", "Somewhere else")).toEqual({ found: false }));
});

describe("regionTable", () => {
  it("is there when the section has rows of a label and a number", () => expect(regionTable(table, "click & collect availability")).toBe(true));
  it("is not there when the heading is missing", () => expect(regionTable(table, "Delivery")).toBe(false));
  it("is not there when the section has no rows with numbers", () => {
    expect(regionTable(page([["Click & Collect Availability", 2, ["Not available online"]]]), "click & collect")).toBe(false);
  });
});
