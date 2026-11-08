import { afterEach, describe, expect, it } from "vitest";
import { fetchVariantPages, listLocations, VARIANTS_PAGE_SIZE, estimateVariantsPageCost } from "./catalog.js";
import { isShopifyError } from "./errors.js";
import { LOC_A, LOC_B, makeVariant } from "../test/fake-catalog.js";
import { startFakeStore } from "../test/helpers.js";

type Store = Awaited<ReturnType<typeof startFakeStore>>;
let store: Store | undefined;
afterEach(async () => {
  await store?.stop();
  store = undefined;
});

const locations = [
  { id: LOC_A, name: "Shop floor", isActive: true },
  { id: LOC_B, name: "Back room", isActive: true },
  { id: "gid://shopify/Location/3", name: "Old warehouse", isActive: false },
];

async function collect(client: Store["client"], locationId: string) {
  const all = [];
  for await (const page of fetchVariantPages(client, locationId)) all.push(...page);
  return all;
}

const failure = async (p: Promise<unknown>) => {
  try {
    await p;
    throw new Error("expected a rejection");
  } catch (e) {
    return isShopifyError(e) ? e.code : String(e);
  }
};

describe("listLocations", () => {
  it("returns the active locations with id, name and status", async () => {
    store = await startFakeStore({ locations, variants: [] });
    expect(await listLocations(store.client)).toEqual([
      { id: LOC_A, name: "Shop floor", isActive: true },
      { id: LOC_B, name: "Back room", isActive: true },
    ]);
  });

  it("does not ask Shopify for inactive locations", async () => {
    store = await startFakeStore({ locations, variants: [] });
    await listLocations(store.client);
    expect(store.catalog.queries.join(" ")).not.toMatch(/includeInactive/);
  });

  it("reads every page of locations", async () => {
    const many = Array.from({ length: 120 }, (_, i) => ({ id: `gid://shopify/Location/${i + 10}`, name: `L${i}`, isActive: true }));
    store = await startFakeStore({ locations: many, variants: [] });
    expect(await listLocations(store.client)).toHaveLength(120);
  });

  it("stops with an error instead of looping forever if Shopify never finishes paging", async () => {
    store = await startFakeStore({ locations, variants: [] });
    store.fake.setGraphQL(() => ({
      body: { data: { locations: { nodes: [], pageInfo: { hasNextPage: true, endCursor: "cursor-0" } } } },
    }));
    expect(await failure(listLocations(store.client))).toBe("unexpected_reply");
  });

  it("refuses a reply missing required fields", async () => {
    store = await startFakeStore({ locations, variants: [] });
    store.fake.setGraphQL(() => ({
      body: { data: { locations: { nodes: [{ id: LOC_A }], pageInfo: { hasNextPage: false, endCursor: null } } } },
    }));
    expect(await failure(listLocations(store.client))).toBe("unexpected_reply");
  });
});

describe("fetchVariantPages", () => {
  it("maps every field of a variant", async () => {
    store = await startFakeStore({
      locations,
      variants: [
        makeVariant(1, {
          title: "Blue / Large",
          sku: null,
          options: [{ name: "Colour", value: "Blue" }, { name: "Size", value: "Large" }],
          policy: "CONTINUE",
          tracked: false,
          stock: { [LOC_A]: 8 },
        }),
      ],
    });
    expect(await collect(store.client, LOC_A)).toEqual([
      {
        variantId: "gid://shopify/ProductVariant/1",
        productId: "gid://shopify/Product/1",
        productTitle: "Product 1",
        variantTitle: "Blue / Large",
        options: [{ name: "Colour", value: "Blue" }, { name: "Size", value: "Large" }],
        sku: null,
        inventoryItemId: "gid://shopify/InventoryItem/1",
        tracked: false,
        inventoryPolicy: "CONTINUE",
        available: 8,
      },
    ]);
  });

  it("reads stock at the chosen location and passes it as a variable", async () => {
    store = await startFakeStore({ locations, variants: [makeVariant(1), makeVariant(2)] });
    expect((await collect(store.client, LOC_A)).map((v) => v.available)).toEqual([1, 2]);
    expect((await collect(store.client, LOC_B)).map((v) => v.available)).toEqual([101, 102]);
  });

  it("reports a variant that is not stocked at the location as empty, not as 0", async () => {
    store = await startFakeStore({
      locations,
      variants: [makeVariant(1, { stock: { [LOC_A]: 0 } }), makeVariant(2, { stock: { [LOC_B]: 5 } })],
    });
    const [stockedAtZero, notStocked] = await collect(store.client, LOC_A);
    expect(stockedAtZero!.available).toBe(0);
    expect(notStocked!.available).toBeNull();
  });

  it("reads every page, in pages of a fixed size", async () => {
    store = await startFakeStore({
      locations,
      variants: Array.from({ length: 120 }, (_, i) => makeVariant(i + 1)),
    });
    expect(await collect(store.client, LOC_A)).toHaveLength(120);
    expect(store.catalog.pageSizes).toEqual([VARIANTS_PAGE_SIZE, VARIANTS_PAGE_SIZE, VARIANTS_PAGE_SIZE]);
  });

  it("keeps each page's expected cost well under Shopify's 1,000 point limit", () => {
    expect(VARIANTS_PAGE_SIZE).toBeLessThanOrEqual(100);
    expect(estimateVariantsPageCost(VARIANTS_PAGE_SIZE)).toBeLessThan(600);
  });

  it("returns nothing for a store with no variants", async () => {
    store = await startFakeStore({ locations, variants: [] });
    expect(await collect(store.client, LOC_A)).toEqual([]);
  });

  it("refuses a page that says there is more but gives no cursor", async () => {
    store = await startFakeStore({ locations, variants: [] });
    store.fake.setGraphQL(() => ({
      body: { data: { productVariants: { nodes: [], pageInfo: { hasNextPage: true, endCursor: null } } } },
    }));
    expect(await failure(collect(store.client, LOC_A))).toBe("unexpected_reply");
  });

  it("refuses an inventory policy it does not know", async () => {
    store = await startFakeStore({ locations, variants: [makeVariant(1)] });
    const original = store.catalog.handler;
    store.fake.setGraphQL(async (req, n) => {
      const reply = await original(req, n);
      (reply.body as { data: { productVariants: { nodes: { inventoryPolicy: string }[] } } }).data.productVariants.nodes[0]!.inventoryPolicy = "MAYBE";
      return reply;
    });
    expect(await failure(collect(store.client, LOC_A))).toBe("unexpected_reply");
  });

  it("refuses a variant that is missing a field", async () => {
    store = await startFakeStore({ locations, variants: [makeVariant(1)] });
    const original = store.catalog.handler;
    store.fake.setGraphQL(async (req, n) => {
      const reply = await original(req, n);
      delete (reply.body as { data: { productVariants: { nodes: Record<string, unknown>[] } } }).data.productVariants.nodes[0]!.title;
      return reply;
    });
    expect(await failure(collect(store.client, LOC_A))).toBe("unexpected_reply");
  });

  it("asks only for fields it needs and never sends a mutation", async () => {
    store = await startFakeStore({ locations, variants: [makeVariant(1)] });
    await collect(store.client, LOC_A);
    await listLocations(store.client);
    for (const q of store.catalog.queries) {
      expect(q).not.toMatch(/\bmutation\b/i);
      expect(q.trim()).toMatch(/^query\b/);
    }
  });
});
