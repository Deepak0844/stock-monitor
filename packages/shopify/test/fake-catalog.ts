// A fake product catalog for the fake Shopify server. Field names follow Shopify's 2026-10 reference
// for locations and productVariants. Supports cursor paging and a variant being stocked, or not,
// at a location.
import type { GraphQLHandler } from "./fake-shopify.js";

export type FakeLocation = { id: string; name: string; isActive: boolean };
export type FakeVariant = {
  id: string;
  title: string;
  sku: string | null;
  options: { name: string; value: string }[];
  policy: "DENY" | "CONTINUE";
  tracked: boolean;
  productId: string;
  productTitle: string;
  inventoryItemId: string;
  /** location id to available quantity. A location that is missing means "not stocked there". */
  stock: Record<string, number>;
};

export const LOC_A = "gid://shopify/Location/1";
export const LOC_B = "gid://shopify/Location/2";

export function makeVariant(n: number, over: Partial<FakeVariant> = {}): FakeVariant {
  return {
    id: `gid://shopify/ProductVariant/${n}`,
    title: `Size ${n}`,
    sku: `SKU-${n}`,
    options: [{ name: "Size", value: String(n) }],
    policy: "DENY",
    tracked: true,
    productId: `gid://shopify/Product/${Math.ceil(n / 3)}`,
    productTitle: `Product ${Math.ceil(n / 3)}`,
    inventoryItemId: `gid://shopify/InventoryItem/${n}`,
    stock: { [LOC_A]: n, [LOC_B]: 100 + n },
    ...over,
  };
}

const cost = { requestedQueryCost: 50, actualQueryCost: 40, throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 960, restoreRate: 50 } };

export function createFakeCatalog(init: { locations: FakeLocation[]; variants: FakeVariant[] }) {
  let locations = init.locations;
  let variants = init.variants;
  let failFromVariantRequest: number | null = null;
  const pageSizes: number[] = [];
  const queries: string[] = [];
  let variantPages = 0;

  const paged = <T>(items: T[], first: number, after: string | null) => {
    const start = after ? Number(after.replace("cursor-", "")) + 1 : 0;
    const slice = items.slice(start, start + first);
    const end = start + slice.length - 1;
    return { slice, pageInfo: { hasNextPage: end < items.length - 1, endCursor: slice.length ? `cursor-${end}` : null } };
  };

  const handler: GraphQLHandler = (request) => {
    queries.push(request.query);
    const first = Number(request.variables?.first ?? 10);
    const after = (request.variables?.after as string | null | undefined) ?? null;

    if (/\blocations\s*\(/.test(request.query)) {
      const includeInactive = /includeInactive\s*:\s*true/.test(request.query);
      const list = locations.filter((l) => includeInactive || l.isActive);
      const { slice, pageInfo } = paged(list, first, after);
      return { body: { data: { locations: { nodes: slice, pageInfo } }, extensions: { cost } } };
    }

    if (/\bproductVariants\s*\(/.test(request.query)) {
      variantPages += 1;
      pageSizes.push(first);
      if (failFromVariantRequest !== null && variantPages >= failFromVariantRequest) {
        return { body: { errors: [{ message: "internal", extensions: { code: "INTERNAL_SERVER_ERROR" } }] } };
      }
      const locationId = request.variables?.locationId as string;
      const { slice, pageInfo } = paged(variants, first, after);
      const nodes = slice.map((v) => ({
        id: v.id,
        title: v.title,
        sku: v.sku,
        selectedOptions: v.options,
        inventoryPolicy: v.policy,
        product: { id: v.productId, title: v.productTitle },
        inventoryItem: {
          id: v.inventoryItemId,
          tracked: v.tracked,
          inventoryLevel:
            v.stock[locationId] === undefined ? null : { quantities: [{ name: "available", quantity: v.stock[locationId] }] },
        },
      }));
      return { body: { data: { productVariants: { nodes, pageInfo } }, extensions: { cost } } };
    }

    return { body: { errors: [{ message: "unknown query", extensions: { code: "UNKNOWN" } }] } };
  };

  return {
    handler,
    setLocations: (next: FakeLocation[]) => void (locations = next),
    setVariants: (next: FakeVariant[]) => void (variants = next),
    /** From the nth productVariants request onward (counting from 1), answer with a server error. */
    failAtVariantPage: (n: number | null) => {
      failFromVariantRequest = n;
      variantPages = 0;
    },
    pageSizes,
    queries,
  };
}
