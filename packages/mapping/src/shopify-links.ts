import { cleanAddress, sameSite } from "./address.js";
import type { SupplierRef } from "./rows.js";

export type ShopifyLinkSource = { variantId: string; productTitle: string; variantTitle: string; sku: string | null; supplierName: string; supplierUrl: string };
export type ShopifyLinkPlan = {
  rows: { variantId: string; supplierId: string; url: string }[];
  problems: { product: string; sku: string | null; message: string }[];
};

const label = (s: ShopifyLinkSource) => (s.variantTitle && s.variantTitle !== "Default Title" ? `${s.productTitle} (${s.variantTitle})` : s.productTitle);

/**
 * Decides which links to set from the supplier name and page address Shopify holds. Shopify is the one source, so a good pair
 * always becomes the variant's link. A pair that cannot be used is skipped and explained, never guessed at. `suppliers` is keyed
 * by the supplier's name in lower case, like the import's.
 */
export function planShopifyLinks(sources: ShopifyLinkSource[], suppliers: Map<string, SupplierRef>): ShopifyLinkPlan {
  const plan: ShopifyLinkPlan = { rows: [], problems: [] };
  for (const source of sources) {
    const problem = (message: string) => plan.problems.push({ product: label(source), sku: source.sku, message });
    const supplier = suppliers.get(source.supplierName.trim().toLowerCase());
    if (!supplier) {
      problem(`Supplier "${source.supplierName.trim()}" is not in the app.`);
      continue;
    }
    const address = cleanAddress(source.supplierUrl);
    if (!address.ok) {
      problem(address.message);
      continue;
    }
    if (!sameSite(address.url, supplier.host)) {
      problem("That address is not on this supplier's website.");
      continue;
    }
    plan.rows.push({ variantId: source.variantId, supplierId: supplier.id, url: address.url });
  }
  return plan;
}
