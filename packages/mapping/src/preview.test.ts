import { describe, expect, it } from "vitest";
import { buildPreview } from "./preview.js";
import type { RowContext } from "./rows.js";

const ctx: RowContext = {
  suppliers: new Map([["acme", { id: "s1", host: "acme.test" }]]),
  variantsBySku: new Map([["A", ["va"]], ["B", ["vb"]], ["C", ["vc"]], ["D", ["vd"]], ["DUP", ["v1", "v2"]]]),
};
const row = (line: number, sku: string, url: string, supplierName = "Acme") => ({ line, handle: "h", sku, supplierName, addressCell: url });

describe("buildPreview", () => {
  it("counts new, replaced and unchanged links", () => {
    const existing = new Map([
      ["vb", { supplierId: "s1", url: "https://acme.test/old" }],
      ["vc", { supplierId: "s1", url: "https://acme.test/c" }],
    ]);
    const p = buildPreview([row(2, "A", "https://acme.test/a"), row(3, "B", "https://acme.test/b"), row(4, "C", "https://acme.test/c")], ctx, existing);
    expect(p.counts).toEqual({ new: 1, replace: 1, unchanged: 1 });
    expect(p.good).toHaveLength(3);
  });

  it("counts other suppliers' rows as skipped, not as problems", () => {
    const p = buildPreview([row(2, "A", "https://x.test/a", "Other")], ctx, new Map());
    expect(p).toMatchObject({ skippedSuppliers: 1, problems: [], good: [] });
  });

  it("reports a SKU that appears twice in the file on its second row", () => {
    const p = buildPreview([row(2, "A", "https://acme.test/a"), row(3, "A", "https://acme.test/a2")], ctx, new Map());
    expect(p.good).toHaveLength(1);
    expect(p.problems).toEqual([{ line: 3, sku: "A", message: "The same SKU appears twice in the file." }]);
  });

  it("reports a SKU shared by two Shopify variants", () => {
    const p = buildPreview([row(2, "DUP", "https://acme.test/a")], ctx, new Map());
    expect(p.problems[0]).toMatchObject({ line: 2, message: "SKU DUP matches two variants." });
  });

  it("refuses a variant that is already linked to another supplier", () => {
    const p = buildPreview([row(2, "A", "https://acme.test/a")], ctx, new Map([["va", { supplierId: "other", url: "https://o.test" }]]));
    expect(p.problems[0]?.message).toBe("That variant already has a link to another supplier.");
  });

  it("warns, but still accepts, when two variants share one page", () => {
    const p = buildPreview([row(2, "A", "https://acme.test/same"), row(3, "B", "https://acme.test/same")], ctx, new Map());
    expect(p.good).toHaveLength(2);
    expect(p.warnings).toEqual([{ line: 3, sku: "B", message: "Another row in this file uses the same page address." }]);
  });

  it("counts rows for variants that Shopify already supplies as skipped, and saves none of them", () => {
    const managed: RowContext = { ...ctx, shopifyManaged: new Set(["va"]) };
    const p = buildPreview([row(2, "A", "https://acme.test/a"), row(3, "B", "https://acme.test/b")], managed, new Map());
    expect(p).toMatchObject({ skippedShopify: 1, problems: [], counts: { new: 1, replace: 0, unchanged: 0 } });
    expect(p.good.map((g) => g.sku)).toEqual(["B"]);
  });
});
