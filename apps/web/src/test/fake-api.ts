import { vi } from "vitest";
import type { Api, ConnectionCheck, ShopifyApi, ShopifyConnection, Supplier, SuppliersApi, ScheduleApi, CheckRun, Mapping, MappingsApi, Capture, CapturesApi, RecipesApi, RecipeVersion, StockApi, LoginSession, LoginSessionsApi, AppNotification, NotificationsApi, Proposal, ProposalsApi, VariantItem, VariantPage } from "../api.js";

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

export const aProposal = (over: Partial<Proposal> = {}): Proposal => ({
  id: "p1",
  state: "open",
  kind: "set_zero_out_of_stock",
  productTitle: "Blue Tee",
  variantTitle: "Large",
  sku: "S-1",
  supplierName: "Acme Supply",
  shopifyQuantitySeen: 4,
  proposedQuantity: 0,
  approvedQuantity: null,
  edited: false,
  createdAt: "2026-11-10T08:00:00.000Z",
  expiresAt: "2026-11-11T08:00:00.000Z",
  decidedAt: null,
  appliedAt: null,
  note: null,
  closedReason: null,
  resultCode: null,
  resultQuantity: null,
  observed: { answer: "out_of_stock", reason: null, at: "2026-11-10T07:30:00.000Z" },
  tracked: true,
  continueSelling: false,
  blockedReason: null,
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
  supplierName: null,
  supplierUrl: null,
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
  scheduleIntervalMinutes: null,
  scheduleWindowStart: null,
  scheduleWindowEnd: null,
  nextCheckAt: null,
  enabled: true,
  sessionStatus: "not_connected",
  pausedReason: null,
  lastSessionCheckAt: null,
  automationPermission: "unknown",
  permissionNote: null,
  permissionSetAt: null,
  checkPauseSeconds: 10,
  defaultRegion: null,
  createdAt: "2026-11-08T10:00:00.000Z",
  updatedAt: "2026-11-08T10:00:00.000Z",
  ...over,
});

export const aRun = (over: Partial<CheckRun> = {}): CheckRun => ({
  id: "99999999-9999-4999-8999-999999999999",
  supplierId: "11111111-1111-4111-8111-111111111111",
  trigger: "scheduled",
  startedAt: "2026-11-10T08:00:00.000Z",
  endedAt: "2026-11-10T08:10:00.000Z",
  linksTotal: 40,
  linksDone: 40,
  inStock: 30,
  outOfStock: 7,
  cannotTell: 3,
  outcome: "finished",
  stopReason: null,
  ...over,
});

export const aMapping = (over: Partial<Mapping> = {}): Mapping => ({
  id: "44444444-4444-4444-8444-444444444444",
  variantId: "v1",
  supplierId: "11111111-1111-4111-8111-111111111111",
  url: "https://shop.acme.example/p/blue",
  note: null,
  enabled: true,
  linkStatus: "not_checked",
  lastLinkCheckAt: null,
  lastWorkedAt: null,
  missingChecks: 0,
  productTitle: "Blue Tee",
  variantTitle: "Large",
  sku: "B0361",
  supplierName: "Acme Supply",
  variantRemoved: false,
  shopifyManaged: false,
  unavailableCandidate: false,
  latestStock: null,
  latestSuggestion: null,
  region: null,
  ...over,
});

export const aCapture = (over: Partial<Capture> = {}): Capture => ({
  id: "66666666-6666-4666-8666-666666666666",
  supplierId: "11111111-1111-4111-8111-111111111111",
  mappingId: "44444444-4444-4444-8444-444444444444",
  name: "Blue Tee in stock",
  expectedAnswer: null,
  status: "ready",
  failureReason: null,
  pageClass: "ok",
  keptReason: "example",
  createdAt: "2026-11-10T10:00:00.000Z",
  hasPicture: true,
  ...over,
});

export const aRecipeVersion = (over: Partial<RecipeVersion> = {}): RecipeVersion => ({
  id: "77777777-7777-4777-8777-777777777777",
  supplierId: "11111111-1111-4111-8111-111111111111",
  version: 1,
  rules: { pageChecks: [{ type: "text", text: "Blue Tee" }], inStock: [{ type: "button", label: "Add to cart", enabled: true }], outOfStock: [{ type: "text", text: "Sold out" }] },
  active: false,
  createdAt: "2026-11-10T10:00:00.000Z",
  activatedAt: null,
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

export const aNotification = (over: Partial<AppNotification> = {}): AppNotification => ({
  id: "33333333-3333-4333-8333-333333333333",
  kind: "supplier_needs_reconnect",
  supplierId: "11111111-1111-4111-8111-111111111111",
  supplierName: "Acme Supply",
  message: "Acme Supply needs you to log in again.",
  reason: "login_required",
  createdAt: "2026-11-08T10:00:00.000Z",
  readAt: null,
  ...over,
});

/** A fake API for screen tests. Every method is a spy with a sensible default. */
export function fakeApi(
  over: Partial<Omit<Api, "shopify" | "suppliers" | "schedule" | "loginSessions" | "mappings" | "captures" | "recipes" | "stock" | "proposals">> & {
    shopify?: Partial<ShopifyApi>;
    suppliers?: Partial<SuppliersApi>;
    schedule?: Partial<ScheduleApi>;
    loginSessions?: Partial<LoginSessionsApi>;
    notifications?: Partial<NotificationsApi>;
    proposals?: Partial<ProposalsApi>;
    mappings?: Partial<MappingsApi>;
    captures?: Partial<CapturesApi>;
    recipes?: Partial<RecipesApi>;
    stock?: Partial<StockApi>;
  } = {},
): Api {
  const { shopify, suppliers, schedule, loginSessions, notifications, proposals, mappings, captures, recipes, stock, ...rest } = over;
  return {
    getMe: vi.fn().mockResolvedValue(null),
    login: vi.fn().mockResolvedValue({ email: "owner@example.com" }),
    logout: vi.fn().mockResolvedValue(undefined),
    ...rest,
    notifications: { list: vi.fn().mockResolvedValue([]), ...notifications },
    proposals: {
      open: vi.fn().mockResolvedValue({ proposals: [], writePermission: { state: "ready", message: "Shopify allows this app to change stock." } }),
      history: vi.fn().mockResolvedValue({ proposals: [], hasMore: false, page: 1 }),
      count: vi.fn().mockResolvedValue(0),
      approve: vi.fn().mockImplementation(async (_id, quantity) => aProposal({ state: "approved", approvedQuantity: quantity ?? 0 })),
      reject: vi.fn().mockImplementation(async () => aProposal({ state: "rejected" })),
      refresh: vi.fn().mockResolvedValue(undefined),
      settings: vi.fn().mockResolvedValue({ settings: { defaultQuantity: 5, expiryHours: 24 }, writePermission: { state: "ready", message: "Shopify allows this app to change stock." } }),
      saveSettings: vi.fn().mockImplementation(async (settings) => ({ settings, writePermission: { state: "ready", message: "Shopify allows this app to change stock." } })),
      ...proposals,
    },
    loginSessions: {
      start: vi.fn().mockResolvedValue({ loginSession: aLoginSession(), token: "t".repeat(64) }),
      finish: vi.fn().mockResolvedValue({ loginSession: aLoginSession({ status: "finished" }), session: null }),
      cancel: vi.fn().mockResolvedValue(aLoginSession({ status: "cancelled" })),
      importCookies: vi.fn().mockResolvedValue({ kept: 1, dropped: 0, session: null }),
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
      checkSession: vi.fn().mockResolvedValue(undefined),
      setRegion: vi.fn().mockImplementation(async (_id, region) => aSupplier({ defaultRegion: region })),
      setPermission: vi.fn().mockImplementation(async (_id, input) => aSupplier({ automationPermission: input.status, permissionNote: input.note })),
      ...suppliers,
    },
    schedule: {
      overview: vi.fn().mockResolvedValue([]),
      set: vi.fn().mockImplementation(async (_id, input) => aSupplier({ scheduleIntervalMinutes: input.intervalMinutes, scheduleWindowStart: input.window?.start ?? null, scheduleWindowEnd: input.window?.end ?? null })),
      runs: vi.fn().mockResolvedValue([]),
      ...schedule,
    },
    mappings: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue(aMapping()),
      create: vi.fn().mockImplementation(async (input) => aMapping({ ...input })),
      update: vi.fn().mockImplementation(async (_id, patch) => aMapping({ ...patch })),
      remove: vi.fn().mockResolvedValue(undefined),
      checkLink: vi.fn().mockResolvedValue(undefined),
      checkSupplierLinks: vi.fn().mockResolvedValue(1),
      unmapped: vi.fn().mockResolvedValue({ total: 0, unmapped: 0, items: [] }),
      importColumns: vi.fn(),
      importPreview: vi.fn(),
      importConfirm: vi.fn(),
      ...mappings,
    },
    captures: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue({ ...aCapture(), description: null }),
      request: vi.fn().mockImplementation(async (_id, input) => aCapture({ status: "pending", name: input.name ?? "", mappingId: input.mappingId })),
      label: vi.fn().mockImplementation(async (_id, patch) => aCapture({ ...(patch.name === undefined ? {} : { name: patch.name }), ...(patch.expected === undefined ? {} : { expectedAnswer: patch.expected }) })),
      remove: vi.fn().mockResolvedValue(undefined),
      pictureUrl: (id: string) => `/api/captures/${id}/picture`,
      ...captures,
    },
    recipes: {
      list: vi.fn().mockResolvedValue([]),
      save: vi.fn().mockResolvedValue({ id: "88888888-8888-4888-8888-888888888888", version: 1 }),
      test: vi.fn().mockResolvedValue({ results: [], passed: false }),
      activate: vi.fn().mockImplementation(async () => aRecipeVersion({ active: true })),
      ...recipes,
    },
    stock: {
      checkLink: vi.fn().mockResolvedValue(undefined),
      checkSupplier: vi.fn().mockResolvedValue(1),
      observations: vi.fn().mockResolvedValue([]),
      ...stock,
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
