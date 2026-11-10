import { afterEach, describe, expect, it } from "vitest";
import { assessScopes, checkConnection } from "./connection.js";
import { isShopifyError } from "./errors.js";
import { createFakeCatalog, withFakeShop } from "../test/testing.js";
import { startFakeStore } from "../test/helpers.js";

type Store = Awaited<ReturnType<typeof startFakeStore>>;
let store: Store | undefined;
afterEach(async () => {
  await store?.stop();
  store = undefined;
});

const unused = createFakeCatalog({ locations: [], variants: [] }).handler;

describe("checkConnection", () => {
  it("returns the shop's name and the permissions it was granted", async () => {
    store = await startFakeStore({ locations: [], variants: [] });
    store.fake.setGraphQL(withFakeShop(unused, { shopName: "Acme Supplies", scopes: ["read_products", "read_inventory"] }));
    expect(await checkConnection(store.client)).toEqual({ shopName: "Acme Supplies", scopes: ["read_products", "read_inventory"] });
  });

  it("still succeeds, with unknown permissions, when Shopify will not say what they are", async () => {
    store = await startFakeStore({ locations: [], variants: [] });
    store.fake.setGraphQL(withFakeShop(unused, { scopesDenied: true }));
    expect(await checkConnection(store.client)).toEqual({ shopName: "Fake Store", scopes: null });
  });

  it("fails when the credentials are not accepted", async () => {
    store = await startFakeStore({ locations: [], variants: [] });
    store.fake.revokeIssuedTokens();
    store.fake.setGraphQL(() => ({ status: 401, body: {} }));
    try {
      await checkConnection(store.client);
      expect.unreachable();
    } catch (e) {
      expect(isShopifyError(e) && e.code).toBe("rejected_credentials");
    }
  });
});

describe("assessScopes", () => {
  it("is quiet when the connection can read products and inventory and nothing more", () => {
    expect(assessScopes(["read_products", "read_inventory"])).toEqual({
      ok: true,
      writeScopes: [],
      missingScopes: [],
      warnings: [],
    });
  });

  it("warns, in plain words, when the connection can change the store", () => {
    const result = assessScopes(["read_products", "read_inventory", "write_inventory"]);
    expect(result.ok).toBe(true);
    expect(result.writeScopes).toEqual(["write_inventory"]);
    expect(result.warnings).toEqual([
      "This connection can change stock numbers (write_inventory). The app only does that when you approve a suggestion. If you want it to only read for now, remove that permission in Shopify.",
    ]);
  });

  it("keeps the stronger warning for any other write permission", () => {
    const result = assessScopes(["read_products", "read_inventory", "write_inventory", "write_products"]);
    expect(result.writeScopes).toEqual(["write_inventory", "write_products"]);
    expect(result.warnings).toEqual([
      "This connection can change stock numbers (write_inventory). The app only does that when you approve a suggestion. If you want it to only read for now, remove that permission in Shopify.",
      "This connection can also change more of your store (write_products). This app does not need that, so for extra safety remove those permissions in Shopify.",
    ]);
  });

  it("also spots write permissions for the storefront", () => {
    expect(assessScopes(["read_products", "read_inventory", "unauthenticated_write_checkouts"]).writeScopes).toEqual([
      "unauthenticated_write_checkouts",
    ]);
  });

  it("treats a write permission as also allowing reads, as Shopify does", () => {
    const result = assessScopes(["write_products", "write_inventory"]);
    expect(result.missingScopes).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("names a missing permission in plain words", () => {
    const result = assessScopes(["read_products"]);
    expect(result.ok).toBe(false);
    expect(result.missingScopes).toEqual(["read_inventory"]);
    expect(result.warnings).toEqual(["This connection is missing permission to read inventory. Add it to the app in Shopify, then reconnect."]);
  });

  it("names both when both are missing", () => {
    const result = assessScopes([]);
    expect(result.missingScopes).toEqual(["read_products", "read_inventory"]);
    expect(result.warnings[0]).toContain("products and inventory");
  });

  it("says so when the permissions could not be checked", () => {
    expect(assessScopes(null)).toEqual({
      ok: true,
      writeScopes: [],
      missingScopes: [],
      warnings: ["We could not check which permissions this connection has."],
    });
  });

  it("has no technical words in any message except the permission names", () => {
    for (const scopes of [["write_inventory"], [], null]) {
      for (const w of assessScopes(scopes).warnings) expect(w).not.toMatch(/graphql|http|\btoken\b|\bapi\b|json|exception/i);
    }
  });
});
