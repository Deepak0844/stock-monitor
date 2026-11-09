export type Owner = { email: string };

export type ShopifyConnection = {
  shop: string;
  credentialType: "client_credentials" | "static_token";
  scopes: string[];
  locationId: string | null;
  locationName: string | null;
  status: "connected" | "needs_reconnect";
  connectedAt: string;
  lastSuccessfulCallAt: string | null;
};

/** What a connection check found. `scopes` is null when Shopify would not say. */
export type ConnectionCheck = {
  shopName: string;
  scopes: string[] | null;
  writeScopes: string[];
  missingScopes: string[];
  warnings: string[];
};

export type ShopifyDetails =
  | { shop: string; clientId: string; clientSecret: string }
  | { shop: string; accessToken: string };

export type ShopifyLocation = { id: string; name: string };

export type SyncRun = {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "succeeded" | "failed";
  added: number | null;
  updated: number | null;
  unchanged: number | null;
  removed: number | null;
  total: number | null;
  error: string | null;
};

export type VariantWarning = { code: "not_tracked" | "continue_selling"; message: string };

export type VariantItem = {
  variantId: string;
  productTitle: string;
  variantTitle: string;
  options: { name: string; value: string }[];
  sku: string | null;
  tracked: boolean;
  inventoryPolicy: "DENY" | "CONTINUE";
  /** Stock at the chosen location. null means the variant is not stocked there, which is not the same as 0. */
  available: number | null;
  syncedAt: string;
  warnings: VariantWarning[];
};

export type VariantPage = { items: VariantItem[]; total: number; page: number; pageSize: number };
export type VariantQuery = { page: number; pageSize: number; search?: string; warningsOnly?: boolean };

export type ShopifyApi = {
  getConnection(): Promise<ShopifyConnection | null>;
  /** Checks typed-in details, or the saved connection when none are given. Saves nothing. */
  test(details?: ShopifyDetails): Promise<ConnectionCheck>;
  connect(details: ShopifyDetails): Promise<{ connection: ShopifyConnection } & ConnectionCheck>;
  disconnect(): Promise<void>;
  locations(): Promise<ShopifyLocation[]>;
  chooseLocation(id: string): Promise<ShopifyLocation>;
  startSync(): Promise<void>;
  getSync(): Promise<SyncRun | null>;
  variants(query: VariantQuery): Promise<VariantPage>;
};

export type Supplier = {
  id: string;
  name: string;
  websiteUrl: string;
  loginUrl: string | null;
  checkIntervalMinutes: number;
  enabled: boolean;
  sessionStatus: "not_connected" | "connected" | "needs_reconnect" | "blocked";
  /** Who paused it: the owner, or the app because the session needs attention. null when it is not paused. */
  pausedReason: "owner" | "session" | null;
  lastSessionCheckAt: string | null;
  /** The owner's record of whether this supplier allows automatic checks. Link checks need `granted`. */
  automationPermission: "unknown" | "granted" | "not_granted";
  permissionNote: string | null;
  permissionSetAt: string | null;
  /** Seconds to wait between two pages of this supplier. */
  checkPauseSeconds: number;
  /** The region label stock checks look for on this supplier's pages, unless a link has its own. */
  defaultRegion: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PermissionInput = { status: Supplier["automationPermission"]; note: string | null; pauseSeconds?: number };

export type SupplierInput = { name: string; websiteUrl: string; loginUrl: string | null; checkIntervalMinutes: number };

export type SuppliersApi = {
  list(): Promise<Supplier[]>;
  get(id: string): Promise<Supplier>;
  create(input: SupplierInput): Promise<Supplier>;
  /** Only the fields given are changed. */
  update(id: string, patch: Partial<SupplierInput>): Promise<Supplier>;
  remove(id: string): Promise<void>;
  pause(id: string): Promise<Supplier>;
  resume(id: string): Promise<Supplier>;
  /** Asks for a check of the supplier's saved login. The answer arrives later, as the supplier's status. */
  checkSession(id: string): Promise<void>;
  /** The region stock checks look for. null clears it. */
  setRegion(id: string, region: string | null): Promise<Supplier>;
  /** Records whether the supplier allows automatic checks, and the pause between pages. */
  setPermission(id: string, input: PermissionInput): Promise<Supplier>;
};

export type LinkStatus = "not_checked" | "works" | "never_worked" | "page_missing" | "moved" | "looks_different" | "needs_login" | "could_not_check";

/** A link: this Shopify variant is the same item as this supplier page. */
export type Mapping = {
  id: string;
  variantId: string;
  supplierId: string;
  url: string;
  note: string | null;
  /** The region to look for on this page. null means the supplier's default region. */
  region: string | null;
  enabled: boolean;
  linkStatus: LinkStatus;
  lastLinkCheckAt: string | null;
  lastWorkedAt: string | null;
  missingChecks: number;
  productTitle: string;
  variantTitle: string;
  sku: string | null;
  supplierName: string;
  /** Shopify no longer has the variant. The link is kept. */
  variantRemoved: boolean;
  /** Worked before and the page is missing on two checks at least 6 hours apart. */
  unavailableCandidate: boolean;
  /** What the latest stock check said, or null when none has run. */
  latestStock: LatestStock | null;
};

export type StockAnswer = "in_stock" | "out_of_stock" | "cannot_tell";
export type StockReason = "page_changed" | "both_matched" | "neither_matched" | "quantity_text_disagree" | "not_listed" | "check_failed" | "page_missing" | "never_worked";
export type LatestStock = { answer: StockAnswer; reason: StockReason | null; quantity: number | null; matchedText: string | null; observedAt: string };
export type Observation = LatestStock & { id: number; quantityMismatch: boolean; recipeVersion: number | null; checkResult: string };

/** One saved page, without its text or picture. */
export type Capture = {
  id: string;
  supplierId: string;
  mappingId: string | null;
  name: string;
  expectedAnswer: StockAnswer | null;
  status: "pending" | "ready" | "failed";
  /** A fixed code, never a message. */
  failureReason: string | null;
  pageClass: string | null;
  keptReason: "example" | "page_changed";
  createdAt: string;
  hasPicture: boolean;
};
export type PageDescription = {
  url: string;
  title: string;
  status: number | null;
  pageClass: string;
  sections: { heading: string | null; level: number; lines: string[] }[];
  buttons: { label: string; enabled: boolean; section: string | null }[];
};
export type CaptureDetail = Capture & { description: PageDescription | null };

export type StockRule = { type: "text"; text: string; under?: string } | { type: "button"; label: string; enabled?: boolean; under?: string };
export type Recipe = {
  pageChecks: StockRule[];
  inStock: StockRule[];
  outOfStock: StockRule[];
  quantity?: { label: string; under?: string };
  region?: { under: string };
};
export type RecipeVersion = { id: string; supplierId: string; version: number; rules: Recipe; active: boolean; createdAt: string; activatedAt: string | null };
export type ExampleResult = { id: string; name: string; expected: StockAnswer; passed: boolean; got: { answer: StockAnswer; reason: StockReason | null; quantity: number | null; matchedText: string | null } };
export type RecipeTest = { results: ExampleResult[]; passed: boolean };

export type CapturesApi = {
  list(supplierId: string): Promise<Capture[]>;
  get(id: string): Promise<CaptureDetail>;
  /** Asks for a saved copy of one link's page. It arrives later, as a capture that is pending, then ready or failed. */
  request(supplierId: string, input: { mappingId: string; name?: string }): Promise<Capture>;
  label(id: string, patch: { name?: string; expected?: StockAnswer | null }): Promise<Capture>;
  remove(id: string): Promise<void>;
  /** The address of the capture's picture, for an image. Private: only the signed-in owner can load it. */
  pictureUrl(id: string): string;
};
export type RecipesApi = {
  list(supplierId: string): Promise<RecipeVersion[]>;
  /** Saves the next version. Nothing is turned on by saving. */
  save(supplierId: string, recipe: Recipe): Promise<{ id: string; version: number }>;
  /** Runs a draft on the labelled saved pages and saves nothing. */
  test(supplierId: string, recipe: Recipe): Promise<RecipeTest>;
  activate(id: string): Promise<RecipeVersion>;
};
export type StockApi = {
  checkLink(mappingId: string): Promise<void>;
  /** Asks for a stock check of all of a supplier's links. Returns how many are queued. */
  checkSupplier(supplierId: string): Promise<number>;
  observations(mappingId: string): Promise<Observation[]>;
};
export type MappingFilter = { supplierId?: string; status?: LinkStatus; search?: string };
export type MappingInput = { variantId: string; supplierId: string; url: string; note?: string | null; region?: string | null };
export type UnmappedVariant = { variantId: string; productTitle: string; variantTitle: string; sku: string | null };
export type UnmappedList = { total: number; unmapped: number; items: UnmappedVariant[] };

export type ImportColumnChoice = { handle: number; sku: number; supplier: number; address: number };
export type ImportColumns = { header: string[]; suggested: { [K in keyof ImportColumnChoice]: number | null }; rowCount: number };
export type RowNote = { line: number; sku: string; message: string };
export type ImportPreview = {
  previewId: string;
  goodCount: number;
  sample: { line: number; sku: string; url: string }[];
  skippedSuppliers: number;
  counts: { new: number; replace: number; unchanged: number };
  problems: RowNote[];
  problemCount: number;
  warnings: RowNote[];
};
export type ImportResult = { created: number; updated: number; unchanged: number; skipped: number };

export type MappingsApi = {
  list(filter?: MappingFilter): Promise<Mapping[]>;
  get(id: string): Promise<Mapping>;
  create(input: MappingInput): Promise<Mapping>;
  update(id: string, patch: { url?: string; note?: string | null; region?: string | null; enabled?: boolean }): Promise<Mapping>;
  remove(id: string): Promise<void>;
  /** Asks for a check of one link. The answer arrives later, as the link's status. */
  checkLink(id: string): Promise<void>;
  /** Asks for a check of all of a supplier's links. Returns how many are queued. */
  checkSupplierLinks(supplierId: string): Promise<number>;
  unmapped(search?: string): Promise<UnmappedList>;
  /** The file is the text of the CSV the owner chose. Nothing is saved. */
  importColumns(file: string): Promise<ImportColumns>;
  importPreview(file: string, columns: ImportColumnChoice): Promise<ImportPreview>;
  importConfirm(previewId: string): Promise<ImportResult>;
};

export type LoginStatus = "starting" | "ready" | "connected" | "saving" | "finished" | "cancelled" | "expired" | "failed";
export type LoginSession = {
  id: string;
  supplierId: string;
  status: LoginStatus;
  failureReason: string | null;
  createdAt: string;
  tokenExpiresAt: string;
  /** When the login window closes by itself. */
  expiresAt: string | null;
};
/** Plain facts about a saved login. None of it can be used to log in. */
export type SavedSession = { savedAt: string; lastVerifiedAt: string | null; cookieCount: number; domains: string[]; sizeBytes: number };

export type LoginSessionsApi = {
  /** Opens a login window. The token is the one-time key to its screen: it is returned here and nowhere else. */
  start(supplierId: string): Promise<{ loginSession: LoginSession; token: string }>;
  finish(id: string): Promise<{ loginSession: LoginSession; session: SavedSession | null }>;
  cancel(id: string): Promise<LoginSession>;
  /** For a page that is closing: asks the server to cancel, and does not wait for the answer. */
  cancelOnLeave(id: string): void;
};

/** Something that needs the owner's attention, in plain words. */
export type AppNotification = {
  id: string;
  kind: "supplier_needs_reconnect" | "recipe_needs_review";
  supplierId: string;
  supplierName: string;
  message: string;
  reason: "login_required" | "captcha" | "blocked" | "unknown" | "page_changed";
  createdAt: string;
  readAt: string | null;
};
export type NotificationsApi = {
  /** What is open now, newest first. */
  list(): Promise<AppNotification[]>;
};

export type Api = {
  /** The signed-in owner, or null when nobody is signed in. */
  getMe(): Promise<Owner | null>;
  login(email: string, password: string): Promise<Owner>;
  logout(): Promise<void>;
  shopify: ShopifyApi;
  suppliers: SuppliersApi;
  mappings: MappingsApi;
  captures: CapturesApi;
  recipes: RecipesApi;
  stock: StockApi;
  loginSessions: LoginSessionsApi;
  notifications: NotificationsApi;
};

/** A failed request. The message is plain English from the server. The code says which kind of problem. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const NETWORK_MESSAGE = "Can't reach the server. Check your connection and try again.";
const GENERIC_MESSAGE = "Something went wrong. Please try again.";

async function send(path: string, init: { method: string; json?: unknown; csv?: string }): Promise<Response> {
  try {
    return await fetch(path, {
      method: init.method,
      credentials: "same-origin",
      // Only declare a JSON body when there is one, or the server rejects the empty body.
      ...(init.csv !== undefined
        ? { headers: { "content-type": "text/csv" }, body: init.csv }
        : init.json === undefined
          ? {}
          : { headers: { "content-type": "application/json" }, body: JSON.stringify(init.json) }),
    });
  } catch {
    throw new ApiError(NETWORK_MESSAGE, 0);
  }
}

async function failure(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as { error?: { message?: string; code?: string } };
    return new ApiError(body.error?.message ?? GENERIC_MESSAGE, res.status, body.error?.code ?? null);
  } catch {
    return new ApiError(GENERIC_MESSAGE, res.status);
  }
}

async function request<T>(path: string, init: { method: string; json?: unknown; csv?: string }): Promise<T> {
  const res = await send(path, init);
  if (!res.ok) throw await failure(res);
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError(GENERIC_MESSAGE, res.status);
  }
}

const shopify: ShopifyApi = {
  async getConnection() {
    return (await request<{ connection: ShopifyConnection | null }>("/api/shopify/connection", { method: "GET" })).connection;
  },
  test: (details) => request("/api/shopify/test", { method: "POST", json: details }),
  connect: (details) => request("/api/shopify/connection", { method: "POST", json: details }),
  async disconnect() {
    await request("/api/shopify/connection", { method: "DELETE" });
  },
  async locations() {
    return (await request<{ locations: ShopifyLocation[] }>("/api/shopify/locations", { method: "GET" })).locations;
  },
  async chooseLocation(id) {
    return (await request<{ location: ShopifyLocation }>("/api/shopify/location", { method: "PUT", json: { id } })).location;
  },
  async startSync() {
    await request("/api/shopify/sync", { method: "POST" });
  },
  variants(query) {
    const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) });
    if (query.search) params.set("search", query.search);
    if (query.warningsOnly) params.set("warningsOnly", "true");
    return request(`/api/shopify/variants?${params}`, { method: "GET" });
  },
  async getSync() {
    return (await request<{ lastRun: SyncRun | null }>("/api/shopify/sync", { method: "GET" })).lastRun;
  },
};

const supplier = async (path: string, init: { method: string; json?: unknown }) =>
  (await request<{ supplier: Supplier }>(path, init)).supplier;

const suppliers: SuppliersApi = {
  async list() {
    return (await request<{ suppliers: Supplier[] }>("/api/suppliers", { method: "GET" })).suppliers;
  },
  get: (id) => supplier(`/api/suppliers/${encodeURIComponent(id)}`, { method: "GET" }),
  create: (input) => supplier("/api/suppliers", { method: "POST", json: input }),
  update: (id, patch) => supplier(`/api/suppliers/${encodeURIComponent(id)}`, { method: "PATCH", json: patch }),
  async remove(id) {
    await request(`/api/suppliers/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
  pause: (id) => supplier(`/api/suppliers/${encodeURIComponent(id)}/pause`, { method: "POST" }),
  resume: (id) => supplier(`/api/suppliers/${encodeURIComponent(id)}/resume`, { method: "POST" }),
  async checkSession(id) {
    await request(`/api/suppliers/${encodeURIComponent(id)}/check-session`, { method: "POST" });
  },
  setRegion: (id, region) => supplier(`/api/suppliers/${encodeURIComponent(id)}/region`, { method: "PATCH", json: { region } }),
  setPermission: (id, input) => supplier(`/api/suppliers/${encodeURIComponent(id)}/permission`, { method: "PATCH", json: input }),
};

const enc = encodeURIComponent;
const captures: CapturesApi = {
  async list(supplierId) {
    return (await request<{ captures: Capture[] }>(`/api/suppliers/${enc(supplierId)}/captures`, { method: "GET" })).captures;
  },
  async get(id) {
    return (await request<{ capture: CaptureDetail }>(`/api/captures/${enc(id)}`, { method: "GET" })).capture;
  },
  async request(supplierId, input) {
    return (await request<{ capture: Capture }>(`/api/suppliers/${enc(supplierId)}/captures`, { method: "POST", json: input })).capture;
  },
  async label(id, patch) {
    return (await request<{ capture: Capture }>(`/api/captures/${enc(id)}`, { method: "PATCH", json: patch })).capture;
  },
  async remove(id) {
    await request(`/api/captures/${enc(id)}`, { method: "DELETE" });
  },
  pictureUrl: (id) => `/api/captures/${enc(id)}/picture`,
};
const recipes: RecipesApi = {
  async list(supplierId) {
    return (await request<{ recipes: RecipeVersion[] }>(`/api/suppliers/${enc(supplierId)}/recipes`, { method: "GET" })).recipes;
  },
  async save(supplierId, recipe) {
    return (await request<{ recipe: { id: string; version: number } }>(`/api/suppliers/${enc(supplierId)}/recipes`, { method: "POST", json: { recipe } })).recipe;
  },
  test: (supplierId, recipe) => request(`/api/suppliers/${enc(supplierId)}/recipes/test`, { method: "POST", json: { recipe } }),
  async activate(id) {
    return (await request<{ recipe: RecipeVersion }>(`/api/recipes/${enc(id)}/activate`, { method: "POST" })).recipe;
  },
};
const stock: StockApi = {
  async checkLink(mappingId) {
    await request(`/api/mappings/${enc(mappingId)}/check-stock`, { method: "POST" });
  },
  async checkSupplier(supplierId) {
    return (await request<{ links: number }>(`/api/suppliers/${enc(supplierId)}/check-stock`, { method: "POST" })).links;
  },
  async observations(mappingId) {
    return (await request<{ observations: Observation[] }>(`/api/mappings/${enc(mappingId)}/observations`, { method: "GET" })).observations;
  },
};
const mappings: MappingsApi = {
  async list(filter = {}) {
    const params = new URLSearchParams();
    if (filter.supplierId) params.set("supplierId", filter.supplierId);
    if (filter.status) params.set("status", filter.status);
    if (filter.search) params.set("search", filter.search);
    return (await request<{ mappings: Mapping[] }>(`/api/mappings?${params}`, { method: "GET" })).mappings;
  },
  async get(id) {
    return (await request<{ mapping: Mapping }>(`/api/mappings/${enc(id)}`, { method: "GET" })).mapping;
  },
  async create(input) {
    return (await request<{ mapping: Mapping }>("/api/mappings", { method: "POST", json: input })).mapping;
  },
  async update(id, patch) {
    return (await request<{ mapping: Mapping }>(`/api/mappings/${enc(id)}`, { method: "PATCH", json: patch })).mapping;
  },
  async remove(id) {
    await request(`/api/mappings/${enc(id)}`, { method: "DELETE" });
  },
  async checkLink(id) {
    await request(`/api/mappings/${enc(id)}/check-link`, { method: "POST" });
  },
  async checkSupplierLinks(supplierId) {
    return (await request<{ links: number }>(`/api/suppliers/${enc(supplierId)}/check-links`, { method: "POST" })).links;
  },
  unmapped: (search) => request(`/api/variants?${new URLSearchParams({ mapped: "false", ...(search ? { search } : {}) })}`, { method: "GET" }),
  importColumns: (file) => request("/api/mappings/import/columns", { method: "POST", csv: file }),
  importPreview: (file, c) =>
    request(`/api/mappings/import/preview?${new URLSearchParams({ handle: String(c.handle), sku: String(c.sku), supplier: String(c.supplier), address: String(c.address) })}`, { method: "POST", csv: file }),
  importConfirm: (previewId) => request(`/api/mappings/import/${enc(previewId)}/confirm`, { method: "POST" }),
};

const notifications: NotificationsApi = {
  async list() {
    return (await request<{ notifications: AppNotification[] }>("/api/notifications", { method: "GET" })).notifications;
  },
};

const loginSessions: LoginSessionsApi = {
  start: (supplierId) => request(`/api/suppliers/${encodeURIComponent(supplierId)}/login-session`, { method: "POST" }),
  finish: (id) => request(`/api/login-sessions/${encodeURIComponent(id)}/finish`, { method: "POST" }),
  async cancel(id) {
    return (await request<{ loginSession: LoginSession }>(`/api/login-sessions/${encodeURIComponent(id)}/cancel`, { method: "POST" })).loginSession;
  },
  cancelOnLeave(id) {
    // keepalive lets the request finish after the page has gone. Nothing waits for it, and a failure is ignored.
    void fetch(`/api/login-sessions/${encodeURIComponent(id)}/cancel`, { method: "POST", credentials: "same-origin", keepalive: true }).catch(() => {});
  },
};

export const api: Api = {
  async getMe() {
    const res = await send("/api/me", { method: "GET" });
    if (res.status === 401) return null;
    if (!res.ok) throw await failure(res);
    return (await res.json()) as Owner;
  },
  login: (email, password) => request("/api/login", { method: "POST", json: { email, password } }),
  async logout() {
    await request("/api/logout", { method: "POST" });
  },
  shopify,
  suppliers,
  mappings,
  captures,
  recipes,
  stock,
  loginSessions,
  notifications,
};
