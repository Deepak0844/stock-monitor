import type { ExportRow } from "./export.js";
import { checkRow, type RowContext } from "./rows.js";

export type GoodRow = { line: number; sku: string; variantId: string; supplierId: string; url: string };
export type RowNote = { line: number; sku: string; message: string };
export type Preview = {
  good: GoodRow[];
  skippedSuppliers: number;
  problems: RowNote[];
  warnings: RowNote[];
  counts: { new: number; replace: number; unchanged: number };
};
/** The link each variant already has, keyed by variant id. One link per variant in the pilot. */
export type ExistingLinks = Map<string, { supplierId: string; url: string }>;

/** Everything the owner sees before confirming. Nothing is saved here. */
export function buildPreview(rows: ExportRow[], ctx: RowContext, existing: ExistingLinks): Preview {
  const preview: Preview = { good: [], skippedSuppliers: 0, problems: [], warnings: [], counts: { new: 0, replace: 0, unchanged: 0 } };
  const seenSkus = new Set<string>();
  const seenUrls = new Set<string>();

  for (const row of rows) {
    const result = checkRow(row, ctx);
    if (result.kind === "skipped_supplier") {
      preview.skippedSuppliers++;
      continue;
    }
    const problem = (message: string) => preview.problems.push({ line: row.line, sku: row.sku, message });
    if (result.kind === "problem") {
      problem(result.message);
      continue;
    }
    if (seenSkus.has(row.sku)) {
      problem("The same SKU appears twice in the file.");
      continue;
    }
    seenSkus.add(row.sku);
    const current = existing.get(result.variantId);
    if (current && current.supplierId !== result.supplierId) {
      problem("That variant already has a link to another supplier.");
      continue;
    }
    if (seenUrls.has(result.url)) {
      preview.warnings.push({ line: row.line, sku: row.sku, message: "Another row in this file uses the same page address." });
    }
    seenUrls.add(result.url);
    preview.counts[!current ? "new" : current.url === result.url ? "unchanged" : "replace"]++;
    preview.good.push({ line: row.line, sku: row.sku, variantId: result.variantId, supplierId: result.supplierId, url: result.url });
  }
  return preview;
}
