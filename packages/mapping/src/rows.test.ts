import { describe, expect, it } from "vitest";
import { checkRow, type RowContext } from "./rows.js";

const ctx: RowContext = {
  suppliers: new Map([["acme", { id: "sup-1", host: "acme.test" }]]),
  variantsBySku: new Map([
    ["B1", ["v1"]],
    ["TWO", ["v2", "v3"]],
  ]),
};
const row = (over: Partial<{ sku: string; supplierName: string; addressCell: string }> = {}) => ({
  line: 5, handle: "h", sku: "B1", supplierName: "Acme", addressCell: "https://acme.test/p/1?_pos=2", ...over,
});

describe("checkRow", () => {
  it("accepts a good row and cleans its address", () => {
    expect(checkRow(row(), ctx)).toEqual({ kind: "good", variantId: "v1", supplierId: "sup-1", url: "https://acme.test/p/1" });
  });
  it("matches the supplier ignoring capitals", () => {
    expect(checkRow(row({ supplierName: "ACME" }), ctx).kind).toBe("good");
  });
  it("skips rows for suppliers that are not in the app, and rows with no supplier", () => {
    expect(checkRow(row({ supplierName: "Other" }), ctx)).toEqual({ kind: "skipped_supplier" });
    expect(checkRow(row({ supplierName: "" }), ctx)).toEqual({ kind: "skipped_supplier" });
  });
  it("explains a SKU that matches no variant", () => {
    expect(checkRow(row({ sku: "ZZ" }), ctx)).toEqual({ kind: "problem", message: "SKU ZZ matches no variant." });
  });
  it("explains a SKU that matches two variants", () => {
    expect(checkRow(row({ sku: "TWO" }), ctx)).toEqual({ kind: "problem", message: "SKU TWO matches two variants." });
  });
  it("explains a missing address", () => {
    expect(checkRow(row({ addressCell: "" }), ctx)).toEqual({ kind: "problem", message: "No address in that row." });
  });
  it("explains an address on another website", () => {
    expect(checkRow(row({ addressCell: "https://other.test/p" }), ctx)).toEqual({
      kind: "problem",
      message: "That address is not on this supplier's website.",
    });
  });
});
