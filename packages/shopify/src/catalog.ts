import { z } from "zod";
import type { ShopifyClient } from "./client.js";
import { ShopifyError } from "./errors.js";

export type ShopifyLocation = { id: string; name: string; isActive: boolean };

export type CatalogVariant = {
  variantId: string;
  productId: string;
  productTitle: string;
  variantTitle: string;
  options: { name: string; value: string }[];
  sku: string | null;
  inventoryItemId: string;
  tracked: boolean;
  inventoryPolicy: "DENY" | "CONTINUE";
  /** `available` at the chosen location. Empty when the variant is not stocked there, which is not the same as 0. */
  available: number | null;
  /** The product's supplier-name metafield, trimmed. null when the product has none or it is empty. */
  supplierName: string | null;
  /** The product's supplier-page-address metafield (the SPU), trimmed. null when none or empty. */
  supplierUrl: string | null;
};

export type MetafieldName = { namespace: string; key: string };
/** Which product metafields hold the supplier's name and the supplier's page address. */
export type SupplierMetafields = { supplierName: MetafieldName; supplierUrl: MetafieldName };
export const DEFAULT_SUPPLIER_METAFIELDS: SupplierMetafields = {
  supplierName: { namespace: "custom", key: "supplier_name" },
  supplierUrl: { namespace: "custom", key: "spu" },
};

/** "namespace.key" as Shopify shows it in Custom data, or null when it is not a name Shopify accepts. */
export function parseMetafieldName(text: string): MetafieldName | null {
  const match = /^([A-Za-z0-9_-]{3,255})\.([A-Za-z0-9_-]{2,64})$/.exec(text.trim());
  return match ? { namespace: match[1] as string, key: match[2] as string } : null;
}

export const VARIANTS_PAGE_SIZE = 50;
const LOCATIONS_PAGE_SIZE = 50;
const MAX_LOCATION_PAGES = 20;
const MAX_VARIANT_PAGES = 500; // 25,000 variants, the most Shopify lets a connection page through

/**
 * A conservative guess of the cost of one page, in Shopify's points, so the rate-limit tracker can
 * make room for it. Shopify's pages do not state the cost of these fields. This is our inference:
 * a connection costs 2 plus the page size times what each variant touches (the variant, its
 * product, inventory item, inventory level, quantities and options). Checked against a real store
 * in Task 11.
 */
export const estimateVariantsPageCost = (pageSize: number) => 2 + pageSize * 10;

// Read-only: both are queries, there is no mutation anywhere in this package's Phase A.
const LOCATIONS_QUERY = `query Locations($first: Int!, $after: String) {
  locations(first: $first, after: $after) {
    nodes { id name isActive }
    pageInfo { hasNextPage endCursor }
  }
}`;

const VARIANTS_QUERY = `query Variants($first: Int!, $after: String, $locationId: ID!, $nameNamespace: String!, $nameKey: String!, $urlNamespace: String!, $urlKey: String!) {
  productVariants(first: $first, after: $after) {
    nodes {
      id
      title
      sku
      selectedOptions { name value }
      inventoryPolicy
      product {
        id
        title
        supplierName: metafield(namespace: $nameNamespace, key: $nameKey) { value }
        supplierUrl: metafield(namespace: $urlNamespace, key: $urlKey) { value }
      }
      inventoryItem {
        id
        tracked
        inventoryLevel(locationId: $locationId) {
          quantities(names: ["available"]) { name quantity }
        }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

const pageInfo = z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() });

const locationsReply = z.object({
  locations: z.object({
    nodes: z.array(z.object({ id: z.string().min(1), name: z.string(), isActive: z.boolean() })),
    pageInfo,
  }),
});

const variantsReply = z.object({
  productVariants: z.object({
    nodes: z.array(
      z.object({
        id: z.string().min(1),
        title: z.string(),
        sku: z.string().nullable(),
        selectedOptions: z.array(z.object({ name: z.string(), value: z.string() })),
        inventoryPolicy: z.enum(["DENY", "CONTINUE"]),
        product: z.object({
          id: z.string().min(1),
          title: z.string(),
          supplierName: z.object({ value: z.string() }).nullable().optional(),
          supplierUrl: z.object({ value: z.string() }).nullable().optional(),
        }),
        inventoryItem: z.object({
          id: z.string().min(1),
          tracked: z.boolean(),
          inventoryLevel: z
            .object({ quantities: z.array(z.object({ name: z.string(), quantity: z.number().int() })) })
            .nullable(),
        }),
      }),
    ),
    pageInfo,
  }),
});

/** Walks a cursor-paged connection. Refuses to loop forever or to follow a page that gives no cursor. */
async function* paged<T>(
  maxPages: number,
  fetchPage: (after: string | null) => Promise<{ items: T[]; hasNextPage: boolean; endCursor: string | null }>,
): AsyncGenerator<T[]> {
  let after: string | null = null;
  const cursors = new Set<string>();
  for (let page = 1; page <= maxPages; page++) {
    const result = await fetchPage(after);
    yield result.items;
    if (!result.hasNextPage) return;
    if (!result.endCursor || cursors.has(result.endCursor)) {
      throw new ShopifyError("unexpected_reply", { detail: "paging gave no new cursor" });
    }
    cursors.add(result.endCursor);
    after = result.endCursor;
  }
  throw new ShopifyError("unexpected_reply", { detail: "paging did not finish" });
}

export async function listLocations(client: ShopifyClient): Promise<ShopifyLocation[]> {
  const all: ShopifyLocation[] = [];
  const pages = paged(MAX_LOCATION_PAGES, async (after) => {
    const data = await client.query(LOCATIONS_QUERY, {
      schema: locationsReply,
      variables: { first: LOCATIONS_PAGE_SIZE, after },
    });
    return { items: data.locations.nodes, ...data.locations.pageInfo };
  });
  for await (const page of pages) all.push(...page);
  return all;
}

/** Yields the store's variants one page at a time, with stock at one location. */
export async function* fetchVariantPages(
  client: ShopifyClient,
  locationId: string,
  metafields: SupplierMetafields = DEFAULT_SUPPLIER_METAFIELDS,
): AsyncGenerator<CatalogVariant[]> {
  if (!/^gid:\/\/shopify\/Location\/\d+$/.test(locationId)) throw new Error("Invalid Shopify location id.");

  const pages = paged(MAX_VARIANT_PAGES, async (after) => {
    const data = await client.query(VARIANTS_QUERY, {
      schema: variantsReply,
      variables: {
        first: VARIANTS_PAGE_SIZE,
        after,
        locationId,
        nameNamespace: metafields.supplierName.namespace,
        nameKey: metafields.supplierName.key,
        urlNamespace: metafields.supplierUrl.namespace,
        urlKey: metafields.supplierUrl.key,
      },
      estimatedCost: estimateVariantsPageCost(VARIANTS_PAGE_SIZE),
    });
    return { items: data.productVariants.nodes, ...data.productVariants.pageInfo };
  });

  for await (const nodes of pages) {
    yield nodes.map(
      (v): CatalogVariant => ({
        variantId: v.id,
        productId: v.product.id,
        productTitle: v.product.title,
        variantTitle: v.title,
        options: v.selectedOptions,
        sku: v.sku,
        inventoryItemId: v.inventoryItem.id,
        tracked: v.inventoryItem.tracked,
        inventoryPolicy: v.inventoryPolicy,
        available: v.inventoryItem.inventoryLevel?.quantities.find((q) => q.name === "available")?.quantity ?? null,
        supplierName: v.product.supplierName?.value.trim() || null,
        supplierUrl: v.product.supplierUrl?.value.trim() || null,
      }),
    );
  }
}
