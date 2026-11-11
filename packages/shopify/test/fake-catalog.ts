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
  /** The product's supplier-name and supplier-page-address metafields. Missing or null means the product has none. */
  supplierName?: string | null;
  supplierUrl?: string | null;
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
  const variantVariables: Record<string, unknown>[] = [];
  let variantPages = 0;
  // Writing stock. Follows the 2026-10 reference: inventorySetQuantities needs write_inventory, an @idempotent
  // key, and refuses a change when changeFromQuantity is not the number Shopify holds now.
  let canWrite = true;
  let nextWrite: "refuse" | "apply_then_fail" | "fail_before_apply" | null = null;
  let readsDown = false;
  let readsDownAfterWrite = false;
  let dropWrites = false;
  const reasons: string[] = [];
  const writes: { inventoryItemId: string; locationId: string; quantity: number; changeFromQuantity: number | null; key: string; referenceDocumentUri: string | null }[] = [];
  const replies = new Map<string, unknown>();
  let failAllReplies = false;

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
      variantVariables.push(request.variables ?? {});
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
        product: {
          id: v.productId,
          title: v.productTitle,
          supplierName: v.supplierName == null ? null : { value: v.supplierName },
          supplierUrl: v.supplierUrl == null ? null : { value: v.supplierUrl },
        },
        inventoryItem: {
          id: v.inventoryItemId,
          tracked: v.tracked,
          inventoryLevel:
            v.stock[locationId] === undefined ? null : { quantities: [{ name: "available", quantity: v.stock[locationId] }] },
        },
      }));
      return { body: { data: { productVariants: { nodes, pageInfo } }, extensions: { cost } } };
    }

    if (/\binventoryItem\s*\(/.test(request.query)) {
      if (readsDown) return { status: 500, body: { errors: "boom" } };
      const v = variants.find((x) => x.inventoryItemId === request.variables?.itemId);
      const quantity = v?.stock[request.variables?.locationId as string];
      const level = quantity === undefined ? null : { quantities: [{ name: "available", quantity }] };
      return { body: { data: { inventoryItem: v ? { inventoryLevel: level } : null }, extensions: { cost } } };
    }

    if (/\binventorySetQuantities\b/.test(request.query)) {
      if (!canWrite) return { body: { errors: [{ message: "denied", extensions: { code: "ACCESS_DENIED" } }] } };
      const key = request.variables?.idempotencyKey;
      if (typeof key !== "string" || !/@idempotent\(\s*key\s*:\s*\$idempotencyKey\s*\)/.test(request.query)) {
        return { body: { errors: [{ message: "idempotency key required", extensions: { code: "BAD_REQUEST" } }] } };
      }
      // Shopify's 2026-10 input has exactly these fields. Any other one, such as the removed ignoreCompareQuantity, is a GraphQL error.
      const sent = request.variables?.input as Record<string, unknown> | undefined;
      const unknownField = Object.keys(sent ?? {}).find((k) => !["name", "reason", "referenceDocumentUri", "quantities"].includes(k));
      if (unknownField) return { body: { errors: [{ message: `InputObject 'InventorySetQuantitiesInput' doesn't accept argument '${unknownField}'`, extensions: { code: "argumentNotAccepted" } }] } };
      if (dropWrites) return { status: 500, body: { errors: "boom" } }; // the request never reached the store
      if (replies.has(key)) return failAllReplies ? { status: 500, body: { errors: "boom" } } : { body: replies.get(key) };
      const input = request.variables?.input as { name?: string; reason?: string; referenceDocumentUri?: string; quantities?: { inventoryItemId: string; locationId: string; quantity: number; changeFromQuantity?: number | null }[] };
      const row = input?.quantities?.[0];
      const v = variants.find((x) => x.inventoryItemId === row?.inventoryItemId);
      const answer = (userErrors: { field: string[]; message: string; code: string }[]) => ({
        data: { inventorySetQuantities: { inventoryAdjustmentGroup: userErrors.length ? null : { id: "gid://shopify/InventoryAdjustmentGroup/1" }, userErrors } },
        extensions: { cost },
      });
      if (nextWrite === "fail_before_apply") {
        nextWrite = null;
        dropWrites = true;
        return { status: 500, body: { errors: "boom" } };
      }
      if (nextWrite === "refuse") {
        nextWrite = null;
        return { body: answer([{ field: ["input"], message: "refused", code: "INVALID_QUANTITY_NEGATIVE" }]) };
      }
      if (!row || !v || input.name !== "available" || v.stock[row.locationId] === undefined) {
        return { body: answer([{ field: ["input"], message: "no such item", code: "ITEM_NOT_FOUND" }]) };
      }
      if (row.changeFromQuantity !== v.stock[row.locationId]) {
        const body = answer([{ field: ["input", "quantities", "0", "changeFromQuantity"], message: "stale", code: "CHANGE_FROM_QUANTITY_STALE" }]);
        replies.set(key, body);
        return { body };
      }
      v.stock[row.locationId] = row.quantity;
      reasons.push(input.reason ?? "");
      writes.push({ inventoryItemId: row.inventoryItemId, locationId: row.locationId, quantity: row.quantity, changeFromQuantity: row.changeFromQuantity ?? null, key, referenceDocumentUri: input.referenceDocumentUri ?? null });
      const body = answer([]);
      replies.set(key, body);
      if (nextWrite === "apply_then_fail") {
        nextWrite = null;
        failAllReplies = true;
        if (readsDownAfterWrite) readsDown = true;
      }
      return failAllReplies ? { status: 500, body: { errors: "boom" } } : { body };
    }

    return { body: { errors: [{ message: "unknown query", extensions: { code: "UNKNOWN" } }] } };
  };

  return {
    handler,
    setLocations: (next: FakeLocation[]) => void (locations = next),
    setVariants: (next: FakeVariant[]) => void (variants = next),
    /** Whether the app has write_inventory. */
    setCanWrite: (next: boolean) => void (canWrite = next),
    /** The next write is refused with a user error, or is applied but its reply (and every retry's reply) is a server error. A retry with the same key is answered from the first result. */
    failNextWrite: (how: "refuse" | "apply_then_fail" | "fail_before_apply" | null, options: { readsToo?: boolean } = {}) => {
      nextWrite = how;
      readsDownAfterWrite = Boolean(options.readsToo); // reads stop working once the write has gone through
    },
    /** Stop failing replies after "apply_then_fail" or "fail_before_apply", and let reads work again. */
    recover: () => {
      failAllReplies = false;
      dropWrites = false;
      readsDown = false;
      readsDownAfterWrite = false;
    },
    /** Stock reads answer with a server error, as if the store could not be reached. */
    setReadsDown: (down: boolean) => void (readsDown = down),
    writes,
    /** The reason sent with each accepted write. */
    reasons,
    /** What Shopify holds now, for assertions. */
    stockOf: (inventoryItemId: string, locationId: string) => variants.find((v) => v.inventoryItemId === inventoryItemId)?.stock[locationId],
    /** Change the number behind the app's back, as another sale or a staff edit would. */
    setStock: (inventoryItemId: string, locationId: string, quantity: number) => {
      const v = variants.find((x) => x.inventoryItemId === inventoryItemId);
      if (v) v.stock[locationId] = quantity;
    },
    /** From the nth productVariants request onward (counting from 1), answer with a server error. */
    failAtVariantPage: (n: number | null) => {
      failFromVariantRequest = n;
      variantPages = 0;
    },
    pageSizes,
    variantVariables,
    queries,
  };
}
