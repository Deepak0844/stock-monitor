import { describe, expect, it } from "vitest";
import { readExport } from "./export.js";

const cols = { handle: 0, sku: 1, supplier: 2, address: 3 };

describe("readExport", () => {
  it("carries a product's supplier and address down to its later variant rows", () => {
    const rows = [
      ["tee", "SKU1", "Acme", '["https://x.test/a"]'],
      ["tee", "SKU2", "", ""],
    ];
    expect(readExport(rows, cols)).toEqual([
      { line: 2, handle: "tee", sku: "SKU1", supplierName: "Acme", addressCell: '["https://x.test/a"]' },
      { line: 3, handle: "tee", sku: "SKU2", supplierName: "Acme", addressCell: '["https://x.test/a"]' },
    ]);
  });

  it("drops image-only rows that have no variant SKU, but still carries values past them", () => {
    const rows = [
      ["tee", "SKU1", "Acme", "https://x.test/a"],
      ["tee", "", "", ""],
      ["tee", "SKU2", "", ""],
    ];
    const out = readExport(rows, cols);
    expect(out.map((r) => r.sku)).toEqual(["SKU1", "SKU2"]);
    expect(out[1]?.line).toBe(4);
    expect(out[1]?.supplierName).toBe("Acme");
  });

  it("does not carry values between products", () => {
    const rows = [
      ["a", "S1", "Acme", "https://x.test/a"],
      ["b", "S2", "", ""],
    ];
    expect(readExport(rows, cols)[1]).toMatchObject({ supplierName: "", addressCell: "" });
  });

  it("trims cells", () => {
    expect(readExport([[" tee ", " S1 ", " Acme ", " u "]], cols)[0]).toMatchObject({ handle: "tee", sku: "S1", supplierName: "Acme", addressCell: "u" });
  });
});
