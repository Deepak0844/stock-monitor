import { cleanAddress, sameSite } from "./address.js";
import type { ExportRow } from "./export.js";

export type SupplierRef = { id: string; host: string };
export type RowContext = {
  /** Keyed by the supplier's name in lower case. */
  suppliers: Map<string, SupplierRef>;
  /** Keyed by SKU, value is every variant that has it. */
  variantsBySku: Map<string, string[]>;
};
export type RowResult =
  | { kind: "good"; variantId: string; supplierId: string; url: string }
  | { kind: "skipped_supplier" }
  | { kind: "problem"; message: string };

/** Decides what one export row means. Messages are for the owner: they say what to fix. */
export function checkRow(row: ExportRow, ctx: RowContext): RowResult {
  const supplier = ctx.suppliers.get(row.supplierName.toLowerCase());
  if (!supplier) return { kind: "skipped_supplier" };

  const variants = ctx.variantsBySku.get(row.sku) ?? [];
  if (variants.length === 0) return { kind: "problem", message: `SKU ${row.sku} matches no variant.` };
  if (variants.length > 1) {
    return { kind: "problem", message: `SKU ${row.sku} matches ${variants.length === 2 ? "two" : variants.length} variants.` };
  }

  const address = cleanAddress(row.addressCell);
  if (!address.ok) return { kind: "problem", message: address.message };
  if (!sameSite(address.url, supplier.host)) return { kind: "problem", message: "That address is not on this supplier's website." };
  return { kind: "good", variantId: variants[0] as string, supplierId: supplier.id, url: address.url };
}
