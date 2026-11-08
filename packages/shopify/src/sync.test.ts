import { afterEach, describe, expect, it } from "vitest";
import { syncCatalog, type CatalogStore, type StoredVariant } from "./sync.js";
import type { CatalogVariant } from "./catalog.js";
import { isShopifyError } from "./errors.js";
import { LOC_A, LOC_B, makeVariant } from "../test/fake-catalog.js";
import { startFakeStore } from "../test/helpers.js";

type Store = Awaited<ReturnType<typeof startFakeStore>>;
let fakeStore: Store | undefined;
afterEach(async () => {
  await fakeStore?.stop();
  fakeStore = undefined;
});

const locations = [{ id: LOC_A, name: "Shop floor", isActive: true }];

/** In-memory storage that records what the sync asked it to do. */
function memoryStore() {
  const rows = new Map<string, StoredVariant>();
  const calls = { saved: [] as string[][], removed: [] as string[][] };
  const store: CatalogStore = {
    getAll: async () => [...rows.values()],
    save: async (variants: CatalogVariant[]) => {
      calls.saved.push(variants.map((v) => v.variantId));
      for (const v of variants) rows.set(v.variantId, { ...v, removed: false });
    },
    markRemoved: async (ids: string[]) => {
      calls.removed.push(ids);
      for (const id of ids) {
        const row = rows.get(id);
        if (row) rows.set(id, { ...row, removed: true });
      }
    },
  };
  return { store, rows, calls };
}

const start = (n: number) => startFakeStore({ locations, variants: Array.from({ length: n }, (_, i) => makeVariant(i + 1)) });

describe("syncCatalog", () => {
  it("adds every variant on the first run", async () => {
    fakeStore = await start(5);
    const { store, rows } = memoryStore();
    const result = await syncCatalog({ client: fakeStore.client, locationId: LOC_A, store });
    expect(result).toEqual({ added: 5, updated: 0, unchanged: 0, removed: 0, total: 5 });
    expect(rows.size).toBe(5);
  });

  it("changes nothing, and writes nothing, on a second run with no changes", async () => {
    fakeStore = await start(5);
    const { store, calls } = memoryStore();
    await syncCatalog({ client: fakeStore.client, locationId: LOC_A, store });
    const writesBefore = calls.saved.length;
    const result = await syncCatalog({ client: fakeStore.client, locationId: LOC_A, store });
    expect(result).toEqual({ added: 0, updated: 0, unchanged: 5, removed: 0, total: 5 });
    expect(calls.saved.length).toBe(writesBefore);
    expect(calls.removed).toEqual([]);
  });

  it("updates only the variants that changed", async () => {
    fakeStore = await start(4);
    const { store, calls, rows } = memoryStore();
    await syncCatalog({ client: fakeStore.client, locationId: LOC_A, store });
    fakeStore.catalog.setVariants([
      makeVariant(1),
      makeVariant(2, { stock: { [LOC_A]: 99 } }),
      makeVariant(3, { title: "Renamed" }),
      makeVariant(4),
    ]);
    calls.saved.length = 0;
    const result = await syncCatalog({ client: fakeStore.client, locationId: LOC_A, store });
    expect(result).toEqual({ added: 0, updated: 2, unchanged: 2, removed: 0, total: 4 });
    expect(calls.saved.flat().sort()).toEqual(["gid://shopify/ProductVariant/2", "gid://shopify/ProductVariant/3"]);
    expect(rows.get("gid://shopify/ProductVariant/2")!.available).toBe(99);
  });

  it("marks a variant that disappeared from Shopify as removed, and does not delete it", async () => {
    fakeStore = await start(3);
    const { store, rows, calls } = memoryStore();
    await syncCatalog({ client: fakeStore.client, locationId: LOC_A, store });
    fakeStore.catalog.setVariants([makeVariant(1), makeVariant(3)]);
    const result = await syncCatalog({ client: fakeStore.client, locationId: LOC_A, store });
    expect(result.removed).toBe(1);
    expect(calls.removed).toEqual([["gid://shopify/ProductVariant/2"]]);
    expect(rows.get("gid://shopify/ProductVariant/2")!.removed).toBe(true);
    expect(rows.size).toBe(3);
  });

  it("brings a removed variant back, and counts it as updated, when it reappears", async () => {
    fakeStore = await start(2);
    const { store, rows } = memoryStore();
    await syncCatalog({ client: fakeStore.client, locationId: LOC_A, store });
    fakeStore.catalog.setVariants([makeVariant(1)]);
    await syncCatalog({ client: fakeStore.client, locationId: LOC_A, store });
    fakeStore.catalog.setVariants([makeVariant(1), makeVariant(2)]);
    const result = await syncCatalog({ client: fakeStore.client, locationId: LOC_A, store });
    expect(result).toEqual({ added: 0, updated: 1, unchanged: 1, removed: 0, total: 2 });
    expect(rows.get("gid://shopify/ProductVariant/2")!.removed).toBe(false);
  });

  it("does not mark an already removed variant as removed again", async () => {
    fakeStore = await start(2);
    const { store, calls } = memoryStore();
    await syncCatalog({ client: fakeStore.client, locationId: LOC_A, store });
    fakeStore.catalog.setVariants([makeVariant(1)]);
    await syncCatalog({ client: fakeStore.client, locationId: LOC_A, store });
    calls.removed.length = 0;
    const result = await syncCatalog({ client: fakeStore.client, locationId: LOC_A, store });
    expect(result.removed).toBe(0);
    expect(calls.removed).toEqual([]);
  });

  it("never marks anything removed if the sync fails part way, because it has only seen part of the store", async () => {
    fakeStore = await start(120); // three pages
    const { store, calls } = memoryStore();
    await syncCatalog({ client: fakeStore.client, locationId: LOC_A, store });
    fakeStore.catalog.setVariants(Array.from({ length: 119 }, (_, i) => makeVariant(i + 2))); // variant 1 is gone
    fakeStore.catalog.failAtVariantPage(2);
    calls.removed.length = 0;
    try {
      await syncCatalog({ client: fakeStore.client, locationId: LOC_A, store });
      expect.unreachable();
    } catch (e) {
      expect(isShopifyError(e)).toBe(true);
    }
    expect(calls.removed).toEqual([]);
  });

  it("counts a variant once even if Shopify returns it on two pages", async () => {
    fakeStore = await start(3);
    const original = fakeStore.catalog.handler;
    fakeStore.fake.setGraphQL(async (req, n) => {
      const reply = await original(req, n);
      const connection = (reply.body as { data?: { productVariants?: { nodes: unknown[] } } }).data?.productVariants;
      if (connection) connection.nodes = [...connection.nodes, connection.nodes[0]];
      return reply;
    });
    const { store, rows } = memoryStore();
    const result = await syncCatalog({ client: fakeStore.client, locationId: LOC_A, store });
    expect(result.total).toBe(3);
    expect(rows.size).toBe(3);
  });

  it("reports progress after each page", async () => {
    fakeStore = await start(120);
    const { store } = memoryStore();
    const progress: { pages: number; seen: number }[] = [];
    await syncCatalog({
      client: fakeStore.client,
      locationId: LOC_A,
      store,
      onProgress: (p) => progress.push({ pages: p.pagesFetched, seen: p.variantsSeen }),
    });
    expect(progress).toEqual([{ pages: 1, seen: 50 }, { pages: 2, seen: 100 }, { pages: 3, seen: 120 }]);
  });

  it("refreshes stock when a different location is chosen", async () => {
    fakeStore = await start(2);
    const { store, rows } = memoryStore();
    await syncCatalog({ client: fakeStore.client, locationId: LOC_A, store });
    const result = await syncCatalog({ client: fakeStore.client, locationId: LOC_B, store });
    expect(result.updated).toBe(2);
    expect(rows.get("gid://shopify/ProductVariant/1")!.available).toBe(101);
  });

  it("marks every variant removed when the store has none left", async () => {
    fakeStore = await start(2);
    const { store, rows } = memoryStore();
    await syncCatalog({ client: fakeStore.client, locationId: LOC_A, store });
    fakeStore.catalog.setVariants([]);
    const result = await syncCatalog({ client: fakeStore.client, locationId: LOC_A, store });
    expect(result).toEqual({ added: 0, updated: 0, unchanged: 0, removed: 2, total: 0 });
    expect([...rows.values()].every((r) => r.removed)).toBe(true);
  });
});
