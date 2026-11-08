import { vi } from "vitest";
import type { Api, ConnectionCheck, ShopifyApi, ShopifyConnection, Supplier, SuppliersApi, LoginSession, LoginSessionsApi, VariantItem, VariantPage } from "../api.js";

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

export const aSupplier = (over: Partial<Supplier> = {}): Supplier => ({
  id: "11111111-1111-4111-8111-111111111111",
  name: "Acme Supply",
  websiteUrl: "https://shop.acme.example/",
  loginUrl: null,
  checkIntervalMinutes: 60,
  enabled: true,
  sessionStatus: "not_connected",
  pausedReason: null,
  lastSessionCheckAt: null,
  createdAt: "2026-11-08T10:00:00.000Z",
  updatedAt: "2026-11-08T10:00:00.000Z",
  ...over,
});

export const aLoginSession = (over: Partial<LoginSession> = {}): LoginSession => ({
  id: "22222222-2222-4222-8222-222222222222",
  supplierId: "11111111-1111-4111-8111-111111111111",
  status: "ready",
  failureReason: null,
  createdAt: "2026-11-08T10:00:00.000Z",
  tokenExpiresAt: "2026-11-08T10:10:00.000Z",
  expiresAt: "2026-11-08T10:15:00.000Z",
  ...over,
});

/** A fake API for screen tests. Every method is a spy with a sensible default. */
export function fakeApi(
  over: Partial<Omit<Api, "shopify" | "suppliers" | "loginSessions">> & {
    shopify?: Partial<ShopifyApi>;
    suppliers?: Partial<SuppliersApi>;
    loginSessions?: Partial<LoginSessionsApi>;
  } = {},
): Api {
  const { shopify, suppliers, loginSessions, ...rest } = over;
  return {
    getMe: vi.fn().mockResolvedValue(null),
    login: vi.fn().mockResolvedValue({ email: "owner@example.com" }),
    logout: vi.fn().mockResolvedValue(undefined),
    ...rest,
    loginSessions: {
      start: vi.fn().mockResolvedValue({ loginSession: aLoginSession(), token: "t".repeat(64) }),
      finish: vi.fn().mockResolvedValue({ loginSession: aLoginSession({ status: "finished" }), session: null }),
      cancel: vi.fn().mockResolvedValue(aLoginSession({ status: "cancelled" })),
      cancelOnLeave: vi.fn(),
      ...loginSessions,
    },
    suppliers: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(aSupplier()),
      create: vi.fn().mockImplementation(async (input) => aSupplier({ ...input })),
      update: vi.fn().mockImplementation(async (_id, patch) => aSupplier({ ...patch })),
      remove: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn().mockImplementation(async () => aSupplier({ enabled: false, pausedReason: "owner" })),
      resume: vi.fn().mockImplementation(async () => aSupplier()),
      ...suppliers,
    },
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
