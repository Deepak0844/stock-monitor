import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

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
