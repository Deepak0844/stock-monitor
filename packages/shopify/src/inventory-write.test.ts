import { afterEach, describe, expect, it } from "vitest";
import { readAvailable, setAvailableQuantity, WRITE_MUTATION } from "./inventory-write.js";
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
];
const item = "gid://shopify/InventoryItem/4"; // makeVariant(4) is stocked with 4 at LOC_A
const start = async () => (store = await startFakeStore({ locations, variants: [makeVariant(4)] }));
const write = (s: Store, over: Partial<Parameters<typeof setAvailableQuantity>[0]> = {}) =>
  setAvailableQuantity({ client: s.client, inventoryItemId: item, locationId: LOC_A, quantity: 0, changeFromQuantity: 4, idempotencyKey: "key-1", ...over });

describe("setAvailableQuantity", () => {
  it("sets the number and says applied", async () => {
    const s = await start();
    expect(await write(s)).toEqual({ result: "applied", newQuantity: 0 });
    expect(s.catalog.stockOf(item, LOC_A)).toBe(0);
    expect(s.catalog.stockOf(item, LOC_B)).toBe(104); // another location is never touched
  });

  it("sends only the available quantity of one item at one location, with the key", async () => {
    const s = await start();
    await write(s, { quantity: 7 });
    expect(s.catalog.writes).toEqual([{ inventoryItemId: item, locationId: LOC_A, quantity: 7, changeFromQuantity: 4, key: "key-1" }]);
  });

  it("says changed and writes nothing when Shopify no longer holds the number we saw", async () => {
    const s = await start();
    s.catalog.setStock(item, LOC_A, 3);
    expect(await write(s)).toEqual({ result: "changed" });
    expect(s.catalog.stockOf(item, LOC_A)).toBe(3);
    expect(s.catalog.writes).toEqual([]);
  });

  it("says no_permission when the app may not write stock", async () => {
    const s = await start();
    s.catalog.setCanWrite(false);
    expect(await write(s)).toEqual({ result: "no_permission" });
    expect(s.catalog.stockOf(item, LOC_A)).toBe(4);
  });

  it("says refused when Shopify refuses the change", async () => {
    const s = await start();
    s.catalog.failNextWrite("refuse");
    expect(await write(s)).toEqual({ result: "refused" });
    expect(s.catalog.stockOf(item, LOC_A)).toBe(4);
  });

  it("says unknown when the reply never arrives, even though Shopify applied it", async () => {
    const s = await start();
    s.catalog.failNextWrite("apply_then_fail");
    expect(await write(s)).toEqual({ result: "unknown" });
    expect(s.catalog.stockOf(item, LOC_A)).toBe(0);
  });

  it("a retry with the same key after an unknown outcome does not say changed and does not write again", async () => {
    const s = await start();
    s.catalog.failNextWrite("apply_then_fail");
    await write(s);
    s.catalog.recover();
    expect(await write(s)).toEqual({ result: "applied", newQuantity: 0 });
    expect(s.catalog.writes).toHaveLength(1);
  });

  it("the same key twice writes once", async () => {
    const s = await start();
    await write(s);
    expect(await write(s)).toEqual({ result: "applied", newQuantity: 0 });
    expect(s.catalog.writes).toHaveLength(1);
  });

  it("uses the idempotent form of the mutation, and the key is a variable, never in the query text", async () => {
    expect(WRITE_MUTATION).toMatch(/inventorySetQuantities\(input: \$input\) @idempotent\(key: \$idempotencyKey\)/);
    const s = await start();
    await write(s, { idempotencyKey: "secret-looking-key" });
    expect(s.catalog.queries.at(-1)).not.toContain("secret-looking-key");
  });
});

describe("readAvailable", () => {
  it("reads the number at the location", async () => {
    const s = await start();
    expect(await readAvailable(s.client, item, LOC_A)).toBe(4);
  });
  it("is null when the item is not stocked there, or does not exist", async () => {
    store = await startFakeStore({ locations, variants: [makeVariant(4, { stock: { [LOC_B]: 9 } })] });
    expect(await readAvailable(store.client, item, LOC_A)).toBeNull();
    expect(await readAvailable(store.client, "gid://shopify/InventoryItem/999", LOC_A)).toBeNull();
  });
});
