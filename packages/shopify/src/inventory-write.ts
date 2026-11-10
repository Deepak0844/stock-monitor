// The only place the app changes anything in Shopify, and it changes exactly one thing: the `available`
// quantity of one inventory item at one location. The read-only guard test allows this file and no other.
import { z } from "zod";
import type { ShopifyClient } from "./client.js";
import { isShopifyError } from "./errors.js";

export type WriteResult =
  | { result: "applied"; newQuantity: number }
  /** Shopify no longer holds the number the suggestion was made from. Nothing was written. */
  | { result: "changed" }
  | { result: "refused" }
  | { result: "no_permission" }
  /** The request may or may not have been applied. Retry with the same key, never with a new one. */
  | { result: "unknown" };

export type WriteArgs = {
  client: ShopifyClient;
  inventoryItemId: string;
  locationId: string;
  quantity: number;
  /** The number Shopify held when the suggestion was made. Shopify refuses the change if it holds something else now. */
  changeFromQuantity: number;
  /** Stored on the suggestion when it was approved, so a retry can never apply twice. */
  idempotencyKey: string;
};

export const WRITE_MUTATION = `mutation SetAvailable($input: InventorySetQuantitiesInput!, $idempotencyKey: String!) {
  inventorySetQuantities(input: $input) @idempotent(key: $idempotencyKey) {
    inventoryAdjustmentGroup { id }
    userErrors { field message code }
  }
}`;

const writeReply = z.object({
  inventorySetQuantities: z.object({
    inventoryAdjustmentGroup: z.object({ id: z.string() }).nullable(),
    userErrors: z.array(z.object({ field: z.array(z.string()).nullable().optional(), message: z.string(), code: z.string().nullable().optional() })),
  }),
});

/** Shopify's code for "the number you said it was is not the number it is". */
const STALE = "CHANGE_FROM_QUANTITY_STALE";

export async function setAvailableQuantity(args: WriteArgs): Promise<WriteResult> {
  try {
    const data = await args.client.query(WRITE_MUTATION, {
      schema: writeReply,
      variables: {
        idempotencyKey: args.idempotencyKey,
        input: {
          name: "available",
          reason: "correction",
          ignoreCompareQuantity: false,
          quantities: [
            { inventoryItemId: args.inventoryItemId, locationId: args.locationId, quantity: args.quantity, changeFromQuantity: args.changeFromQuantity },
          ],
        },
      },
    });
    const { userErrors } = data.inventorySetQuantities;
    if (userErrors.length === 0) return { result: "applied", newQuantity: args.quantity };
    return userErrors.some((e) => e.code === STALE) ? { result: "changed" } : { result: "refused" };
  } catch (error) {
    if (!isShopifyError(error)) throw error;
    if (error.code === "no_access") return { result: "no_permission" };
    if (error.code === "rejected_credentials" || error.code === "store_unavailable") return { result: "refused" };
    // Unreachable, throttled after every retry, or a reply we could not read: Shopify may have applied it.
    return { result: "unknown" };
  }
}

const levelReply = z.object({
  inventoryItem: z
    .object({
      inventoryLevel: z.object({ quantities: z.array(z.object({ name: z.string(), quantity: z.number().int() })) }).nullable(),
    })
    .nullable(),
});

const LEVEL_QUERY = `query InventoryLevel($itemId: ID!, $locationId: ID!) {
  inventoryItem(id: $itemId) {
    inventoryLevel(locationId: $locationId) {
      quantities(names: ["available"]) { name quantity }
    }
  }
}`;

/** `available` now, or null when the item is not stocked at the location. */
export async function readAvailable(client: ShopifyClient, inventoryItemId: string, locationId: string): Promise<number | null> {
  const data = await client.query(LEVEL_QUERY, { schema: levelReply, variables: { itemId: inventoryItemId, locationId } });
  return data.inventoryItem?.inventoryLevel?.quantities.find((q) => q.name === "available")?.quantity ?? null;
}
