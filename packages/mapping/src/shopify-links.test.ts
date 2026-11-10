import { describe, expect, it } from "vitest";
import { planShopifyLinks } from "./shopify-links.js";

const suppliers = new Map([["acme foods", { id: "sup-1", host: "acme.test" }]]);
const source = (over: Partial<{ variantId: string; productTitle: string; variantTitle: string; sku: string | null; supplierName: string; supplierUrl: string }> = {}) => ({
  variantId: "v1", productTitle: "Tee", variantTitle: "Large", sku: "S1", supplierName: "Acme Foods", supplierUrl: "https://acme.test/p/1", ...over,
});

describe("planShopifyLinks", () => {
  it("makes a link from a good supplier name and address, matching the name ignoring capitals and spaces around it", () => {
    const plan = planShopifyLinks([source({ supplierName: "  ACME foods " })], suppliers);
    expect(plan).toEqual({ rows: [{ variantId: "v1", supplierId: "sup-1", url: "https://acme.test/p/1" }], problems: [] });
  });

  it("cleans the address the way the import does (search tracking removed, ?variant= kept, a list takes its first address)", () => {
    const plan = planShopifyLinks([source({ supplierUrl: '["https://acme.test/p/1?variant=9&_pos=2&_ss=r"]' })], suppliers);
    expect(plan.rows[0]?.url).toBe("https://acme.test/p/1?variant=9");
  });

  it("skips and explains a supplier that is not in the app", () => {
    const plan = planShopifyLinks([source({ supplierName: "Nobody" })], suppliers);
    expect(plan.rows).toEqual([]);
    expect(plan.problems).toEqual([{ product: "Tee (Large)", sku: "S1", message: 'Supplier "Nobody" is not in the app.' }]);
  });

  it("skips and explains an address that is not a web address, or is on another website", () => {
    const plan = planShopifyLinks([source({ supplierUrl: "not an address" }), source({ variantId: "v2", sku: "S2", supplierUrl: "https://other.test/p" })], suppliers);
    expect(plan.rows).toEqual([]);
    expect(plan.problems.map((p) => p.message)).toEqual(["No address in that row.", "That address is not on this supplier's website."]);
  });

  it("accepts a subdomain of the supplier's website", () => {
    expect(planShopifyLinks([source({ supplierUrl: "https://shop.acme.test/p/1" })], suppliers).rows).toHaveLength(1);
  });

  it("keeps the good ones when others are bad, and labels a product with no variant title by its title", () => {
    const plan = planShopifyLinks([source({ variantId: "v2", sku: null, variantTitle: "Default Title", supplierName: "Nobody" }), source()], suppliers);
    expect(plan.rows.map((r) => r.variantId)).toEqual(["v1"]);
    expect(plan.problems).toEqual([{ product: "Tee", sku: null, message: 'Supplier "Nobody" is not in the app.' }]);
  });
});
