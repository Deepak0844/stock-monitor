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
  /** What the step after the sync did with the supplier name and page address Shopify holds. null when it did not run. */
  links: SyncLinks | null;
};
export type SyncLinks = { added: number; updated: number; skipped: number; problems: { product: string; sku: string | null; message: string }[] };

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
  /** The product's supplier name from Shopify, null when it has none, and its supplier page addresses (SPU), empty when none. */
  supplierName: string | null;
  supplierUrls: string[];
  syncedAt: string;
  warnings: VariantWarning[];
};

export type VariantPage = { items: VariantItem[]; total: number; page: number; pageSize: number };
/** One page of a list, with how many there are in all. */
export type Page<T> = { items: T[]; total: number; page: number; pageSize: number };
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
  /** The supplier name Shopify uses, when it differs from `name`. null: products match on `name`. */
  shopifyName: string | null;
  websiteUrl: string;
  loginUrl: string | null;
  checkIntervalMinutes: number;
  /** Automatic checks: minutes between runs, null = off. */
  scheduleIntervalMinutes: number | null;
  scheduleWindowStart: string | null;
  scheduleWindowEnd: string | null;
  /** Keep login alive: minutes between visits, null = off. */
  keepAliveMinutes: number | null;
  nextCheckAt: string | null;
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
  /** False: the supplier's pages show stock without logging in, so checks use no login at all. */
  needsLogin: boolean;
  /** Log in for the owner before each check, with the saved username and password. */
  autoLogin: boolean;
  stealth: boolean;
  /** The owner's own selectors for the login page. Only the keys that were set. */
  loginSelectors: LoginSelectors | null;
  /** Text that only shows when logged in. Set, a page without it counts as logged out. */
  loggedInMarker: string | null;
  /** Where this supplier's login-code emails come from, when not its website's domain. */
  codeEmailFrom: string | null;
  /** When a password was saved, never the password. */
  credentialsSavedAt: string | null;
  lastAutoLoginAt: string | null;
  lastAutoLoginResult: AutoLoginResult | null;
  autoLoginPausedReason: "wrong_password" | "account_locked" | "too_many_failures" | null;
  createdAt: string;
  updatedAt: string;
};

export type LoginSelectors = { open?: string; account?: string; username?: string; password?: string; submit?: string };
/** One box or button on a supplier's login page: its own short words, and a selector that finds only it. */
export type InspectControl = { label: string; selector: string };
/** What "Check login page" found. Nothing was typed or sent. `found` is what a login would use. */
export type LoginInspection = {
  state: "form" | "opener" | "none" | "captcha" | "unreachable";
  opened: boolean;
  found: Record<"open" | "account" | "username" | "password" | "submit", InspectControl | null>;
  fields: InspectControl[];
  buttons: InspectControl[];
};
export type AutoLoginResult = "ok" | "captcha" | "code_required" | "wrong_password" | "account_locked" | "blocked" | "form_not_found" | "unreachable" | "unknown";
export type CredentialsInput = { username: string; password: string; account?: string };

/** One run of checks for one supplier. Counts and a fixed stop code only. */
export type CheckRun = {
  id: string;
  supplierId: string;
  trigger: "scheduled" | "manual";
  /** `links` runs only check that each link still works, so their stock counts stay 0. */
  kind: "stock" | "links";
  startedAt: string;
  endedAt: string | null;
  linksTotal: number;
  linksDone: number;
  inStock: number;
  outOfStock: number;
  cannotTell: number;
  outcome: "running" | "finished" | "stopped" | "failed";
  stopReason: string | null;
};
/** A whole-supplier run that has just been started: how many links, and the run to follow. */
export type StartedRun = { links: number; runId: string };
export type ScheduleWindow = { start: string; end: string } | null;
export type ScheduleStatus = { state: "off" | "waiting" | "running" } | { state: "not_checked"; reason: string; message: string };
/** What the schedule is doing for one supplier. */
export type ScheduleRow = {
  supplierId: string;
  status: ScheduleStatus;
  intervalMinutes: number | null;
  window: ScheduleWindow;
  nextCheckAt: string | null;
  run: CheckRun | null;
  lastRun: CheckRun | null;
};
export type ScheduleApi = {
  overview(): Promise<ScheduleRow[]>;
  /** Turns automatic checks on (an interval from the list) or off (null), with the quiet-hours window or null for all day, and keep-alive (null = off). */
  set(supplierId: string, input: { intervalMinutes: number | null; window: ScheduleWindow; keepAliveMinutes: number | null }): Promise<Supplier>;
  runs(supplierId: string): Promise<CheckRun[]>;
  /** The supplier's run that is going now, of either kind, or null. */
  currentRun(supplierId: string): Promise<CheckRun | null>;
  /** One run by its id: how far it is, or how it ended. */
  run(runId: string): Promise<CheckRun>;
};

export type PermissionInput = { status: Supplier["automationPermission"]; note: string | null; pauseSeconds?: number };

/** `shopifyName`: the supplier name Shopify uses, when it differs from `name`. */
export type SupplierInput = { name: string; websiteUrl: string; loginUrl: string | null; shopifyName?: string | null };

export type SupplierStatusFilter = "connected" | "needs_reconnect" | "blocked" | "paused" | "not_connected" | "no_login";
export type SuppliersApi = {
  list(): Promise<Supplier[]>;
  /** One page, searched and filtered on the server. */
  page(query: { page: number; pageSize: number; search?: string; status?: SupplierStatusFilter }): Promise<Page<Supplier>>;
  get(id: string): Promise<Supplier>;
  /** Only when the last connection check finished, to follow a check cheaply. */
  status(id: string): Promise<{ checkedAt: string | null }>;
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
  /** Whether the supplier's pages need a login. */
  setNeedsLogin(id: string, needsLogin: boolean): Promise<Supplier>;
  /** Records whether the supplier allows automatic checks, and the pause between pages. */
  setPermission(id: string, input: PermissionInput): Promise<Supplier>;
  /** Saves the supplier login. The server seals it and never returns it. */
  saveCredentials(id: string, input: CredentialsInput): Promise<{ savedAt: string }>;
  removeCredentials(id: string): Promise<void>;
  /** Turns automatic login on or off, and/or sets the login page selectors (null clears them). */
  setAutoLogin(id: string, patch: { autoLogin?: boolean; stealth?: boolean; loginSelectors?: LoginSelectors | null; loggedInMarker?: string | null; codeEmailFrom?: string | null }): Promise<Supplier>;
  /** Asks for one test login. The answer arrives later, as the last automatic login. */
  testAutoLogin(id: string): Promise<void>;
  /** Clears the pause after a failed automatic login. */
  resumeAutoLogin(id: string): Promise<void>;
  /** Looks at the supplier's login page and says what a login would use there. Types and sends nothing. */
  inspectLogin(id: string): Promise<LoginInspection>;
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
  /** The supplier's own option name or SKU, for a page that lists several options. null: none. */
  supplierOption: string | null;
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
  /** The product has a supplier name and page address in Shopify, so the next sync sets this link from them. */
  shopifyManaged: boolean;
  /** Worked before and the page is missing on two checks at least 6 hours apart. */
  unavailableCandidate: boolean;
  /** What the latest stock check said, or null when none has run. */
  latestStock: LatestStock | null;
  /** The link's newest suggestion, or null when it has had none. */
  latestSuggestion: { id: string; state: ProposalState; kind: ProposalKind } | null;
};

export type StockAnswer = "in_stock" | "out_of_stock" | "cannot_tell";
export type StockReason =
  | "page_changed"
  | "both_matched"
  | "neither_matched"
  | "quantity_text_disagree"
  | "not_listed"
  | "check_failed"
  | "page_missing"
  | "never_worked"
  | "variant_unclear"
  | "built_in_unclear";
export type LatestStock = { answer: StockAnswer; reason: StockReason | null; quantity: number | null; matchedText: string | null; observedAt: string };
/** `readBy`: how the page was read (`quick`: its HTML, no browser), or null for an answer from before it was recorded. */
export type Observation = LatestStock & { id: number; quantityMismatch: boolean; recipeVersion: number | null; checkResult: string; readBy?: "quick" | "browser" | null };

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
  /** The offers in the page's built-in product data. Missing on pages saved before it was read. */
  offers?: Offer[];
};
/** One offer from a page's built-in product data (schema.org): its availability, address, SKU and name. */
export type Offer = { availability: string; url: string | null; sku: string | null; name: string | null };
/** How pre-order and back-order count when built-in data is on. */
export type Waiting = "in_stock" | "out_of_stock" | "cannot_tell";
export type CaptureDetail = Capture & { description: PageDescription | null };

export type StockRule = { type: "text"; text: string; under?: string } | { type: "button"; label: string; enabled?: boolean; under?: string };
export type Recipe = {
  pageChecks: StockRule[];
  inStock: StockRule[];
  outOfStock: StockRule[];
  quantity?: { label: string; under?: string };
  region?: { under: string };
  /** Present means on: the page's built-in stock data answers first, the word rules only when it is missing or unclear. */
  builtIn?: { waiting: Waiting };
};
export type RecipeVersion = { id: string; supplierId: string; version: number; rules: Recipe; active: boolean; createdAt: string; activatedAt: string | null };
export type ExampleResult = { id: string; name: string; expected: StockAnswer; passed: boolean; got: { answer: StockAnswer; reason: StockReason | null; quantity: number | null; matchedText: string | null; decidedBy?: "built_in" | "rules" | null } };
export type RecipeTest = { results: ExampleResult[]; passed: boolean };
export type SuggestionKind = "pageCheck" | "inStock" | "outOfStock";
/** One proposed rule with its evidence: how many labelled pages of each answer contain it. */
export type Suggestion = { kind: SuggestionKind; rule: StockRule; seenOn: number; ofTotal: number; seenOnOther: number; otherTotal: number; starter: boolean; checked: boolean };
export type SuggestResult = { ok: false; reason: "need_both_answers" } | { ok: true; suggestions: Suggestion[]; passes: boolean };

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
  /** Proposes rules from the labelled saved pages and saves nothing. */
  suggest(supplierId: string): Promise<SuggestResult>;
  activate(id: string): Promise<RecipeVersion>;
  /** Hides a version that is not turned on. */
  remove(id: string): Promise<void>;
};
export type StockApi = {
  checkLink(mappingId: string): Promise<void>;
  /** Asks for a stock check of all of a supplier's links. Returns how many are queued. */
  checkSupplier(supplierId: string): Promise<StartedRun>;
  observations(mappingId: string): Promise<Observation[]>;
};
/** A link's latest stock answer, or `none` for no stock check yet. */
export type StockFilter = StockAnswer | "none";
export type MappingFilter = { supplierId?: string; status?: LinkStatus; stock?: StockFilter; search?: string };
export type MappingInput = { variantId: string; supplierId: string; url: string; note?: string | null; region?: string | null; supplierOption?: string | null };
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
  /** Rows for variants whose supplier and address come from Shopify: left out. */
  skippedShopify: number;
  counts: { new: number; replace: number; unchanged: number };
  problems: RowNote[];
  problemCount: number;
  warnings: RowNote[];
};
export type ImportResult = { created: number; updated: number; unchanged: number; skipped: number };

export type MappingsApi = {
  list(filter?: MappingFilter): Promise<Mapping[]>;
  /** One page, filtered on the server. */
  page(query: MappingFilter & { page: number; pageSize: number }): Promise<Page<Mapping>>;
  get(id: string): Promise<Mapping>;
  /** Only when the last link and stock checks finished, to follow a check cheaply. */
  status(id: string): Promise<{ linkCheckedAt: string | null; stockCheckedAt: string | null }>;
  create(input: MappingInput): Promise<Mapping>;
  update(id: string, patch: { url?: string; note?: string | null; region?: string | null; supplierOption?: string | null; enabled?: boolean }): Promise<Mapping>;
  remove(id: string): Promise<void>;
  /** Asks for a check of one link. The answer arrives later, as the link's status. */
  checkLink(id: string): Promise<void>;
  /** Asks for a check of all of a supplier's links. Returns how many are queued. */
  checkSupplierLinks(supplierId: string): Promise<StartedRun>;
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
  kind: "supplier_needs_reconnect" | "recipe_needs_review" | "proposal_needs_attention";
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
  markRead(id: string): Promise<void>;
  markAllRead(): Promise<void>;
};

export type ProposalState = "open" | "approved" | "applied" | "conflict" | "failed" | "rejected" | "expired" | "replaced";
export type ProposalKind = "set_zero_out_of_stock" | "set_zero_not_listed" | "set_zero_page_missing" | "restock";
/** One suggested change to a Shopify stock number. Words, numbers and times only. */
export type Proposal = {
  id: string;
  state: ProposalState;
  kind: ProposalKind;
  productTitle: string;
  variantTitle: string;
  sku: string | null;
  supplierName: string;
  shopifyQuantitySeen: number;
  proposedQuantity: number;
  approvedQuantity: number | null;
  edited: boolean;
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
  appliedAt: string | null;
  note: string | null;
  closedReason: "could_not_tell" | "no_longer_needed" | "link_off" | "newer_answer" | null;
  resultCode: string | null;
  resultQuantity: number | null;
  observed: { answer: StockAnswer; reason: StockReason | null; at: string | null } | null;
  tracked: boolean;
  continueSelling: boolean;
  blockedReason: string | null;
};
export type WritePermission = { state: "ready" | "missing" | "not_connected"; message: string };
export type ProposalSettings = { defaultQuantity: number; expiryHours: number };
export type ProposalsApi = {
  /** Suggestions waiting for the owner, and ones approved and waiting for Shopify. */
  open(): Promise<{ proposals: Proposal[]; writePermission: WritePermission }>;
  /** One page of the suggestions waiting for the owner, and ones approved and waiting for Shopify. */
  openPage(query: { page: number; pageSize: number; supplierId?: string }): Promise<Page<Proposal> & { writePermission: WritePermission }>;
  history(page: number, pageSize?: number, supplierId?: string): Promise<{ proposals: Proposal[]; hasMore: boolean; total: number; page: number; pageSize: number }>;
  count(): Promise<number>;
  /** How many suggestions wait for the owner, per supplier id. Suppliers with none are left out. */
  waitingBySupplier(): Promise<Record<string, number>>;
  /** Approves one suggestion. Pass a number to change it first. */
  approve(id: string, quantity?: number): Promise<Proposal>;
  reject(id: string): Promise<Proposal>;
  /** After a conflict, a failure or an expiry: read Shopify's numbers again. A new suggestion appears if one still applies. */
  refresh(id: string): Promise<void>;
  settings(): Promise<{ settings: ProposalSettings; writePermission: WritePermission }>;
  saveSettings(settings: ProposalSettings): Promise<{ settings: ProposalSettings; writePermission: WritePermission }>;
};

export type Api = {
  /** The signed-in owner, or null when nobody is signed in. */
  getMe(): Promise<Owner | null>;
  login(email: string, password: string): Promise<Owner>;
  logout(): Promise<void>;
  shopify: ShopifyApi;
  suppliers: SuppliersApi;
  schedule: ScheduleApi;
  mappings: MappingsApi;
  captures: CapturesApi;
  recipes: RecipesApi;
  stock: StockApi;
  loginSessions: LoginSessionsApi;
  notifications: NotificationsApi;
  proposals: ProposalsApi;
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

/** For answers with no body we need (204, or 202 with a small body we do not read). */
async function done(path: string, init: { method: string; json?: unknown }): Promise<void> {
  const res = await send(path, init);
  if (!res.ok) throw await failure(res);
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
  page({ page, pageSize, search, status }) {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (search) params.set("search", search);
    if (status) params.set("status", status);
    return request<Page<Supplier>>(`/api/suppliers?${params}`, { method: "GET" });
  },
  get: (id) => supplier(`/api/suppliers/${encodeURIComponent(id)}`, { method: "GET" }),
  status: (id) => request(`/api/suppliers/${encodeURIComponent(id)}/status`, { method: "GET" }),
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
  setNeedsLogin: (id, needsLogin) => supplier(`/api/suppliers/${encodeURIComponent(id)}`, { method: "PATCH", json: { needsLogin } }),
  setPermission: (id, input) => supplier(`/api/suppliers/${encodeURIComponent(id)}/permission`, { method: "PATCH", json: input }),
  saveCredentials: (id, input) => request(`/api/suppliers/${encodeURIComponent(id)}/credentials`, { method: "PUT", json: input }),
  removeCredentials: (id) => done(`/api/suppliers/${encodeURIComponent(id)}/credentials`, { method: "DELETE" }),
  setAutoLogin: (id, patch) => supplier(`/api/suppliers/${encodeURIComponent(id)}`, { method: "PATCH", json: patch }),
  testAutoLogin: (id) => done(`/api/suppliers/${encodeURIComponent(id)}/auto-login/test`, { method: "POST" }),
  resumeAutoLogin: (id) => done(`/api/suppliers/${encodeURIComponent(id)}/auto-login/resume`, { method: "POST" }),
  async inspectLogin(id) {
    return (await request<{ inspection: LoginInspection }>(`/api/suppliers/${encodeURIComponent(id)}/auto-login/inspect`, { method: "POST", json: {} })).inspection;
  },
};

const enc = encodeURIComponent;
const schedule: ScheduleApi = {
  async overview() {
    return (await request<{ schedule: ScheduleRow[] }>("/api/schedule", { method: "GET" })).schedule;
  },
  set: (supplierId, input) => supplier(`/api/suppliers/${enc(supplierId)}/schedule`, { method: "PUT", json: input }),
  async runs(supplierId) {
    return (await request<{ runs: CheckRun[] }>(`/api/suppliers/${enc(supplierId)}/runs`, { method: "GET" })).runs;
  },
  async currentRun(supplierId) {
    return (await request<{ run: CheckRun | null }>(`/api/suppliers/${enc(supplierId)}/runs/current`, { method: "GET" })).run;
  },
  async run(runId) {
    return (await request<{ run: CheckRun }>(`/api/check-runs/${enc(runId)}`, { method: "GET" })).run;
  },
};
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
  suggest: (supplierId) => request(`/api/suppliers/${enc(supplierId)}/recipes/suggest`, { method: "POST", json: {} }),
  async activate(id) {
    return (await request<{ recipe: RecipeVersion }>(`/api/recipes/${enc(id)}/activate`, { method: "POST" })).recipe;
  },
  async remove(id) {
    await request(`/api/recipes/${enc(id)}`, { method: "DELETE" });
  },
};
const stock: StockApi = {
  async checkLink(mappingId) {
    await request(`/api/mappings/${enc(mappingId)}/check-stock`, { method: "POST" });
  },
  async checkSupplier(supplierId) {
    const { links, runId } = await request<StartedRun>(`/api/suppliers/${enc(supplierId)}/check-stock`, { method: "POST" });
    return { links, runId };
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
  async page({ page, pageSize, ...filter }) {
    const params = new URLSearchParams();
    if (filter.supplierId) params.set("supplierId", filter.supplierId);
    if (filter.status) params.set("status", filter.status);
    if (filter.stock) params.set("stock", filter.stock);
    if (filter.search) params.set("search", filter.search);
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    const body = await request<{ mappings: Mapping[]; total: number; page: number; pageSize: number }>(`/api/mappings?${params}`, { method: "GET" });
    return { items: body.mappings, total: body.total, page: body.page, pageSize: body.pageSize };
  },
  async get(id) {
    return (await request<{ mapping: Mapping }>(`/api/mappings/${enc(id)}`, { method: "GET" })).mapping;
  },
  status: (id) => request(`/api/mappings/${enc(id)}/status`, { method: "GET" }),
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
    const { links, runId } = await request<StartedRun>(`/api/suppliers/${enc(supplierId)}/check-links`, { method: "POST" });
    return { links, runId };
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
  async markRead(id) {
    await request(`/api/notifications/${enc(id)}/read`, { method: "POST", json: {} });
  },
  async markAllRead() {
    await request("/api/notifications/read-all", { method: "POST", json: {} });
  },
};

const proposals: ProposalsApi = {
  open: () => request("/api/proposals?tab=open", { method: "GET" }),
  async openPage({ page, pageSize, supplierId }) {
    const params = new URLSearchParams({ tab: "open", page: String(page), pageSize: String(pageSize) });
    if (supplierId) params.set("supplierId", supplierId);
    const body = await request<{ proposals: Proposal[]; total: number; page: number; pageSize: number; writePermission: WritePermission }>(
      `/api/proposals?${params}`,
      { method: "GET" },
    );
    return { items: body.proposals, total: body.total, page: body.page, pageSize: body.pageSize, writePermission: body.writePermission };
  },
  history: (page, pageSize, supplierId) => {
    const params = new URLSearchParams({ tab: "history", page: String(page) });
    if (pageSize !== undefined) params.set("pageSize", String(pageSize));
    if (supplierId) params.set("supplierId", supplierId);
    return request(`/api/proposals?${params}`, { method: "GET" });
  },
  async count() {
    return (await request<{ open: number }>("/api/proposals/count", { method: "GET" })).open;
  },
  async waitingBySupplier() {
    return (await request<{ bySupplier: Record<string, number> }>("/api/proposals/count", { method: "GET" })).bySupplier;
  },
  async approve(id, quantity) {
    return (await request<{ proposal: Proposal }>(`/api/proposals/${enc(id)}/approve`, { method: "POST", json: quantity === undefined ? {} : { quantity } })).proposal;
  },
  async reject(id) {
    return (await request<{ proposal: Proposal }>(`/api/proposals/${enc(id)}/reject`, { method: "POST", json: {} })).proposal;
  },
  async refresh(id) {
    await request(`/api/proposals/${enc(id)}/refresh`, { method: "POST", json: {} });
  },
  settings: () => request("/api/settings/proposals", { method: "GET" }),
  saveSettings: (settings) => request("/api/settings/proposals", { method: "PUT", json: settings }),
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
  schedule,
  stock,
  loginSessions,
  notifications,
  proposals,
};
