import { fetchVariantPages, type CatalogVariant } from "./catalog.js";
import type { ShopifyClient } from "./client.js";

export type StoredVariant = CatalogVariant & { removed: boolean };

/** Where synced variants are kept. The database implements this in a later task. */
export interface CatalogStore {
  getAll(): Promise<StoredVariant[]>;
  /** Insert or update by variant id. Saving a variant also clears its removed mark. */
  save(variants: CatalogVariant[]): Promise<void>;
  markRemoved(variantIds: string[]): Promise<void>;
}

export type SyncProgress = { pagesFetched: number; variantsSeen: number };
export type SyncResult = { added: number; updated: number; unchanged: number; removed: number; total: number };

const same = (a: CatalogVariant, b: CatalogVariant) =>
  a.productId === b.productId &&
  a.productTitle === b.productTitle &&
  a.variantTitle === b.variantTitle &&
  a.sku === b.sku &&
  a.inventoryItemId === b.inventoryItemId &&
  a.tracked === b.tracked &&
  a.inventoryPolicy === b.inventoryPolicy &&
  a.available === b.available &&
  JSON.stringify(a.options) === JSON.stringify(b.options);

/**
 * Copies the store's variants and their stock at one location into `store`. Safe to run again and
 * again: only changed variants are written. Variants that vanished from Shopify are marked removed
 * (never deleted), and only after the whole catalog has been read, because a half-read catalog
 * would wrongly make everything unread look removed.
 */
export async function syncCatalog(args: {
  client: ShopifyClient;
  locationId: string;
  store: CatalogStore;
  onProgress?: (progress: SyncProgress) => void;
}): Promise<SyncResult> {
  const known = new Map((await args.store.getAll()).map((v) => [v.variantId, v]));
  const seen = new Set<string>();
  let added = 0;
  let updated = 0;
  let unchanged = 0;
  let pagesFetched = 0;

  for await (const page of fetchVariantPages(args.client, args.locationId)) {
    pagesFetched += 1;
    const toSave: CatalogVariant[] = [];
    for (const variant of page) {
      if (seen.has(variant.variantId)) continue; // Shopify can repeat a variant if the store changes while paging
      seen.add(variant.variantId);
      const existing = known.get(variant.variantId);
      if (!existing) {
        added += 1;
        toSave.push(variant);
      } else if (existing.removed || !same(existing, variant)) {
        updated += 1;
        toSave.push(variant);
      } else {
        unchanged += 1;
      }
    }
    if (toSave.length > 0) await args.store.save(toSave);
    args.onProgress?.({ pagesFetched, variantsSeen: seen.size });
  }

  const gone = [...known.values()].filter((v) => !v.removed && !seen.has(v.variantId)).map((v) => v.variantId);
  if (gone.length > 0) await args.store.markRemoved(gone);

  return { added, updated, unchanged, removed: gone.length, total: seen.size };
}
