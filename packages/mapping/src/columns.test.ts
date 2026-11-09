import { describe, expect, it } from "vitest";
import { suggestColumns } from "./columns.js";

describe("suggestColumns", () => {
  const header = ["Handle", "Title", "Variant SKU", "Image Src", "Product metafield (app--123--supplier_name)", "Conversation starters"];

  it("finds the SKU, handle and supplier columns by their headers", () => {
    const s = suggestColumns(header, []);
    expect(s).toMatchObject({ handle: 0, sku: 2, supplier: 4 });
  });

  it("picks the address column by its cells and ignores image columns", () => {
    const sample = [
      ["tee", "Tee", "S1", "https://cdn.test/a.jpg", "Acme", '["https://acme.test/p/1?_pos=1"]'],
      ["tee", "", "S2", "https://cdn.test/b.jpg", "", ""],
    ];
    expect(suggestColumns(header, sample).address).toBe(5);
  });

  it("returns null for a column it cannot find", () => {
    expect(suggestColumns(["a", "b"], [["1", "2"]])).toEqual({ handle: null, sku: null, supplier: null, address: null });
  });
});
