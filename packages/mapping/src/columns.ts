export type SuggestedColumns = { handle: number | null; sku: number | null; supplier: number | null; address: number | null };

const HAS_ADDRESS = /https?:\/\//i;
const IMAGE_HEADER = /image|img|photo|picture/i;

const find = (header: string[], test: (h: string) => boolean) => {
  const i = header.findIndex(test);
  return i === -1 ? null : i;
};

/**
 * Guesses which columns of the Shopify export to read. The owner can change every guess.
 * The address column is the one whose cells hold the most web addresses, ignoring image columns.
 */
export function suggestColumns(header: string[], sample: string[][]): SuggestedColumns {
  let address: number | null = null;
  let best = 0;
  header.forEach((name, i) => {
    if (IMAGE_HEADER.test(name)) return;
    const hits = sample.filter((row) => HAS_ADDRESS.test(row[i] ?? "")).length;
    if (hits > best) {
      best = hits;
      address = i;
    }
  });
  return {
    handle: find(header, (h) => h.trim().toLowerCase() === "handle"),
    sku: find(header, (h) => h.trim().toLowerCase() === "variant sku"),
    supplier: find(header, (h) => h.toLowerCase().includes("supplier_name")),
    address,
  };
}
