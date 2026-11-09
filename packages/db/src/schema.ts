import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  customType,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const appSessions = pgTable("app_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Append-only. No foreign key on actor_user_id: a cascading action would need UPDATE rights,
// and the app role must never be able to change or delete audit rows.
export const auditEvents = pgTable("audit_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  actorUserId: uuid("actor_user_id"),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  details: jsonb("details").notNull().default({}),
  requestId: text("request_id"),
});

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// One row at most: `id` can only be true. Credentials are stored encrypted (AES-256-GCM), never as text.
export const shopifyConnection = pgTable(
  "shopify_connection",
  {
    id: boolean("id").primaryKey().default(true),
    shop: text("shop").notNull(),
    credentialType: text("credential_type").notNull(),
    credentialsCiphertext: text("credentials_ciphertext").notNull(),
    credentialsIv: text("credentials_iv").notNull(),
    credentialsTag: text("credentials_tag").notNull(),
    credentialsKeyId: text("credentials_key_id").notNull(),
    scopes: text("scopes").array().notNull().default(sql`'{}'::text[]`),
    locationId: text("location_id"),
    locationName: text("location_name"),
    status: text("status").notNull().default("connected"),
    connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
    lastSuccessfulCallAt: timestamp("last_successful_call_at", { withTimezone: true }),
  },
  (t) => [
    check("shopify_connection_single_row", sql`${t.id} = true`),
    check("shopify_connection_status", sql`${t.status} in ('connected', 'needs_reconnect')`),
    check("shopify_connection_credential_type", sql`${t.credentialType} in ('client_credentials', 'static_token')`),
  ],
);

// Variants are marked removed, never deleted, so history and later mappings keep their target.
export const shopifyVariants = pgTable(
  "shopify_variants",
  {
    variantId: text("variant_id").primaryKey(),
    productId: text("product_id").notNull(),
    productTitle: text("product_title").notNull(),
    variantTitle: text("variant_title").notNull(),
    options: jsonb("options").notNull(),
    sku: text("sku"),
    inventoryItemId: text("inventory_item_id").notNull(),
    tracked: boolean("tracked").notNull(),
    inventoryPolicy: text("inventory_policy").notNull(),
    available: integer("available"),
    quantityReadAt: timestamp("quantity_read_at", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
  },
  (t) => [
    check("shopify_variants_policy", sql`${t.inventoryPolicy} in ('DENY', 'CONTINUE')`),
    index("shopify_variants_product_idx").on(t.productId),
  ],
);

export const shopifySyncRuns = pgTable(
  "shopify_sync_runs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    status: text("status").notNull().default("running"),
    added: integer("added"),
    updated: integer("updated"),
    unchanged: integer("unchanged"),
    removed: integer("removed"),
    total: integer("total"),
    error: text("error"),
  },
  (t) => [
    check("shopify_sync_runs_status", sql`${t.status} in ('running', 'succeeded', 'failed')`),
    // At most one sync can be running at a time, enforced by the database.
    uniqueIndex("shopify_sync_one_running").on(t.status).where(sql`${t.status} = 'running'`),
  ],
);

// `enabled` false means paused. `paused_reason` says who paused it: the owner (never lifted
// automatically) or the app because the session needs attention. The two always agree.
export const suppliers = pgTable(
  "suppliers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    websiteUrl: text("website_url").notNull(),
    loginUrl: text("login_url"),
    checkIntervalMinutes: integer("check_interval_minutes").notNull().default(60),
    enabled: boolean("enabled").notNull().default(true),
    sessionStatus: text("session_status").notNull().default("not_connected"),
    pausedReason: text("paused_reason"),
    lastSessionCheckAt: timestamp("last_session_check_at", { withTimezone: true }),
    // The owner's record of whether this supplier allows automatic checks. Link checks need `granted`.
    // A reminder and a record, not a legal control: the owner sets it.
    automationPermission: text("automation_permission").notNull().default("unknown"),
    permissionNote: text("permission_note"),
    permissionSetAt: timestamp("permission_set_at", { withTimezone: true }),
    /** Seconds to wait between two pages of this supplier. At least the supplier's own crawl delay. */
    checkPauseSeconds: integer("check_pause_seconds").notNull().default(10),
    /** The region label stock checks look for on a supplier's page, unless a link has its own. */
    defaultRegion: text("default_region"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("suppliers_session_status", sql`${t.sessionStatus} in ('not_connected', 'connected', 'needs_reconnect', 'blocked')`),
    check("suppliers_automation_permission", sql`${t.automationPermission} in ('unknown', 'granted', 'not_granted')`),
    check("suppliers_check_pause", sql`${t.checkPauseSeconds} >= 1`),
    check("suppliers_default_region", sql`${t.defaultRegion} is null or char_length(${t.defaultRegion}) between 1 and 200`),
    check("suppliers_check_interval", sql`${t.checkIntervalMinutes} between 15 and 1440`),
    check(
      "suppliers_pause_reason",
      sql`(${t.enabled} and ${t.pausedReason} is null) or (not ${t.enabled} and ${t.pausedReason} is not null and ${t.pausedReason} in ('owner', 'session'))`,
    ),
    uniqueIndex("suppliers_name_unique").on(sql`lower(${t.name})`),
  ],
);

// One interactive login. Only one can be open at a time, because there is one shared screen, and the
// database enforces it. The one-time token is stored only as a hash. `failure_reason` is a fixed code, never free text.
export const loginSessions = pgTable(
  "login_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    status: text("status").notNull().default("starting"),
    startedBy: uuid("started_by").references(() => users.id, { onDelete: "set null" }),
    /** The browser service's own id for the window. Not secret. */
    browserSessionId: text("browser_session_id"),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }).notNull(),
    /** When the browser closes the window by itself. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    tokenUsedAt: timestamp("token_used_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [
    check("login_sessions_status", sql`${t.status} in ('starting', 'ready', 'connected', 'saving', 'finished', 'cancelled', 'expired', 'failed')`),
    check(
      "login_sessions_failure_reason",
      sql`${t.failureReason} is null or ${t.failureReason} in ('browser_unavailable', 'window_failed', 'window_already_open', 'read_failed', 'save_failed')`,
    ),
    // At most one open attempt anywhere: every open row has the same constant key.
    uniqueIndex("login_sessions_one_open").on(sql`(true)`).where(sql`${t.status} in ('starting', 'ready', 'connected', 'saving')`),
  ],
);

// The saved login, sealed (AES-256-GCM). The screens never read this table. Beside it are plain facts that
// say nothing secret: which sites it covers and how big it is.
export const supplierSessions = pgTable("supplier_sessions", {
  supplierId: uuid("supplier_id")
    .primaryKey()
    .references(() => suppliers.id, { onDelete: "cascade" }),
  stateCiphertext: text("state_ciphertext").notNull(),
  stateIv: text("state_iv").notNull(),
  stateTag: text("state_tag").notNull(),
  stateKeyId: text("state_key_id").notNull(),
  cookieCount: integer("cookie_count").notNull(),
  domains: text("domains").array().notNull().default(sql`'{}'::text[]`),
  sizeBytes: integer("size_bytes").notNull(),
  savedAt: timestamp("saved_at", { withTimezone: true }).notNull().defaultNow(),
  lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
});

// A message for the dashboard. At most one is open for each kind and supplier, however many times the same
// problem is found: the database enforces it. A resolved one is kept as history.
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "cascade" }),
    /** Plain English, ready to show. It never contains a secret. */
    message: text("message").notNull(),
    /** What the check found: a fixed code, never free text. */
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    check("notifications_kind", sql`${t.kind} in ('supplier_needs_reconnect', 'recipe_needs_review')`),
    check("notifications_reason", sql`${t.reason} in ('login_required', 'captcha', 'blocked', 'unknown', 'page_changed')`),
    uniqueIndex("notifications_one_open").on(t.kind, t.supplierId).where(sql`${t.resolvedAt} is null`),
  ],
);

// One link: this Shopify variant is the same item as this supplier page. The variant keeps its row when Shopify
// removes it, so a link is never orphaned (no cascade). Deleting a supplier deletes its links. "One link per
// variant" is a rule in the app, not here, so it can be lifted without a migration. Holds the link's history only:
// never stock, prices, page text, cookies or sessions.
export const mappings = pgTable(
  "mappings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    variantId: text("variant_id")
      .notNull()
      .references(() => shopifyVariants.variantId),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    note: text("note"),
    /** The region label to look for on this link's page. Left empty, the supplier's default region is used. */
    region: text("region"),
    enabled: boolean("enabled").notNull().default(true),
    linkStatus: text("link_status").notNull().default("not_checked"),
    lastLinkCheckAt: timestamp("last_link_check_at", { withTimezone: true }),
    lastWorkedAt: timestamp("last_worked_at", { withTimezone: true }),
    workedTitle: text("worked_title"),
    workedHeading: text("worked_heading"),
    missingChecks: integer("missing_checks").notNull().default(0),
    firstMissingAt: timestamp("first_missing_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "mappings_link_status",
      sql`${t.linkStatus} in ('not_checked', 'works', 'never_worked', 'page_missing', 'moved', 'looks_different', 'needs_login', 'could_not_check')`,
    ),
    check("mappings_region", sql`${t.region} is null or char_length(${t.region}) between 1 and 200`),
    uniqueIndex("mappings_variant_supplier_unique").on(t.variantId, t.supplierId),
    index("mappings_supplier_idx").on(t.supplierId),
  ],
);

// A parsed upload waiting for the owner to confirm, so the preview and the import are the same rows. Only the
// checked rows (variant, supplier, address) are kept: never descriptions or other columns. Deleted after use or an hour.
export const importPreviews = pgTable("import_previews", {
  id: uuid("id").primaryKey().defaultRandom(),
  rows: jsonb("rows").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// A supplier's stock rules. Never edited: every save is the next version, and at most one is on at a time (the database
// enforces it). `rules` is the validated recipe: words and lists, never patterns or code.
export const stockRecipes = pgTable(
  "stock_recipes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    rules: jsonb("rules").notNull(),
    active: boolean("active").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("stock_recipes_supplier_version").on(t.supplierId, t.version),
    uniqueIndex("stock_recipes_one_active").on(t.supplierId).where(sql`${t.active}`),
  ],
);

// A saved page: what the browser showed (never cookies, form values or scripts) and a picture. Private page content: only
// the signed-in owner reads it, it is never logged, and unlabelled and page-changed ones are deleted after 30 days.
// The link is kept as null when the link is deleted, so the owner's examples survive.
export const pageCaptures = pgTable(
  "page_captures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "cascade" }),
    mappingId: uuid("mapping_id").references(() => mappings.id, { onDelete: "set null" }),
    name: text("name").notNull().default(""),
    /** The answer the owner expects from this page. Set means it is a test example. */
    expectedAnswer: text("expected_answer"),
    status: text("status").notNull().default("pending"),
    /** A fixed code, never a message. */
    failureReason: text("failure_reason"),
    pageClass: text("page_class"),
    description: jsonb("description"),
    picture: bytea("picture"),
    keptReason: text("kept_reason").notNull().default("example"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("page_captures_status", sql`${t.status} in ('pending', 'ready', 'failed')`),
    check("page_captures_expected", sql`${t.expectedAnswer} is null or ${t.expectedAnswer} in ('in_stock', 'out_of_stock', 'cannot_tell')`),
    check("page_captures_kept", sql`${t.keptReason} in ('example', 'page_changed')`),
    index("page_captures_supplier_idx").on(t.supplierId, t.createdAt),
  ],
);

// What one check saw. Append only: the app role may add rows but never change or remove them (a link or supplier delete still
// removes them, through the foreign key). Holds the short matched line at most, never page text, a picture or a session.
export const stockObservations = pgTable(
  "stock_observations",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    mappingId: uuid("mapping_id")
      .notNull()
      .references(() => mappings.id, { onDelete: "cascade" }),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
    answer: text("answer").notNull(),
    reason: text("reason"),
    quantity: integer("quantity"),
    matchedText: text("matched_text"),
    quantityMismatch: boolean("quantity_mismatch").notNull().default(false),
    recipeVersion: integer("recipe_version"),
    checkResult: text("check_result").notNull(),
    captureId: uuid("capture_id").references(() => pageCaptures.id, { onDelete: "set null" }),
  },
  (t) => [
    check("stock_observations_answer", sql`${t.answer} in ('in_stock', 'out_of_stock', 'cannot_tell')`),
    index("stock_observations_mapping_idx").on(t.mappingId, t.observedAt),
  ],
);
