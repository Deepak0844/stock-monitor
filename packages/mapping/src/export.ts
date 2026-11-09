export type Columns = { handle: number; sku: number; supplier: number; address: number };
export type ExportRow = { line: number; handle: string; sku: string; supplierName: string; addressCell: string };

/**
 * Turns Shopify export rows into one row per variant. Shopify writes a product's supplier and address only on
 * its first row, so blank values are carried down from the earlier row with the same handle. Rows with no
 * Variant SKU (image rows) are dropped. `line` is the row's line in the file, counting the header as line 1.
 * Only the four needed columns are read: descriptions and everything else are never looked at.
 */
export function readExport(rows: string[][], cols: Columns): ExportRow[] {
  const out: ExportRow[] = [];
  let handle = "";
  let supplierName = "";
  let addressCell = "";
  rows.forEach((row, index) => {
    const cell = (i: number) => (row[i] ?? "").trim();
    const rowHandle = cell(cols.handle);
    if (rowHandle !== handle) {
      handle = rowHandle;
      supplierName = "";
      addressCell = "";
    }
    supplierName = cell(cols.supplier) || supplierName;
    addressCell = cell(cols.address) || addressCell;
    const sku = cell(cols.sku);
    if (sku) out.push({ line: index + 2, handle, sku, supplierName, addressCell });
  });
  return out;
}
