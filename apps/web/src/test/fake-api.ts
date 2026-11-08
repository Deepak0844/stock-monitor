import { vi } from "vitest";
import type { Api, ConnectionCheck, ShopifyApi, ShopifyConnection, VariantItem, VariantPage } from "../api.js";

export const aCheck = (over: Partial<ConnectionCheck> = {}): ConnectionCheck => ({
  shopName: "Acme Supplies",
  scopes: ["read_products", "read_inventory"],
  writeScopes: [],
  missingScopes: [],
  warnings: [],
  ...over,
});

export const aConnection = (over: Partial<ShopifyConnection> = {}): ShopifyConnection => ({
  shop: "acme.myshopify.com",
  credentialType: "client_credentials",
  scopes: ["read_products", "read_inventory"],
  locationId: null,
  locationName: null,
  status: "connected",
  connectedAt: "2026-11-08T10:00:00.000Z",
  lastSuccessfulCallAt: null,
  ...over,
});

export const aVariant = (n: number, over: Partial<VariantItem> = {}): VariantItem => ({
  variantId: `gid://shopify/ProductVariant/${n}`,
  productTitle: `Product ${n}`,
  variantTitle: `Size ${n}`,
  options: [{ name: "Size", value: String(n) }],
  sku: `SKU-${n}`,
  tracked: true,
  inventoryPolicy: "DENY",
  available: n,
  syncedAt: "2026-11-08T10:00:00.000Z",
  warnings: [],
  ...over,
});

export const aPage = (items: VariantItem[], over: Partial<VariantPage> = {}): VariantPage => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 25,
  ...over,
});

/** A fake API for screen tests. Every method is a spy with a sensible default. */
export function fakeApi(over: Partial<Omit<Api, "shopify">> & { shopify?: Partial<ShopifyApi> } = {}): Api {
  const { shopify, ...rest } = over;
  return {
    getMe: vi.fn().mockResolvedValue(null),
    login: vi.fn().mockResolvedValue({ email: "owner@example.com" }),
    logout: vi.fn().mockResolvedValue(undefined),
    ...rest,
    shopify: {
      getConnection: vi.fn().mockResolvedValue(null),
      test: vi.fn().mockResolvedValue(aCheck()),
      connect: vi.fn().mockResolvedValue({ connection: aConnection(), ...aCheck() }),
      disconnect: vi.fn().mockResolvedValue(undefined),
      locations: vi.fn().mockResolvedValue([]),
      chooseLocation: vi.fn().mockImplementation(async (id: string) => ({ id, name: "Chosen location" })),
      startSync: vi.fn().mockResolvedValue(undefined),
      getSync: vi.fn().mockResolvedValue(null),
      variants: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 }),
      ...shopify,
    },
  };
}
