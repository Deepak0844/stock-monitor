import { and, asc, desc, eq, ilike, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { decrypt, encrypt } from "@stock-monitor/crypto";
import type { CatalogStore, CatalogVariant, Credentials, StoredVariant, SyncResult } from "@stock-monitor/shopify";
import { shopifyConnection, shopifySyncRuns, shopifyVariants } from "./schema.js";

export type EncryptionKey = { key: Buffer; keyId: string };

/** What the screens may see. It has no credentials of any kind. */
export type ConnectionRecord = {
  shop: string;
  credentialType: "client_credentials" | "static_token";
  scopes: string[];
  locationId: string | null;
  locationName: string | null;
  status: "connected" | "needs_reconnect";
  connectedAt: Date;
  lastSuccessfulCallAt: Date | null;
};

export type SyncRunRecord = {
  id: number;
  startedAt: Date;
  finishedAt: Date | null;
  status: "running" | "succeeded" | "failed";
  added: number | null;
  updated: number | null;
  unchanged: number | null;
  removed: number | null;
  total: number | null;
  error: string | null;
  links: LinkSummary | null;
};

export type VariantRecord = CatalogVariant & { syncedAt: Date };
export type VariantPage = { items: VariantRecord[]; total: number; page: number; pageSize: number };

/** What the step after a sync did with the supplier name and page address Shopify holds. */
export type LinkSummary = { added: number; updated: number; skipped: number; problems: { product: string; sku: string | null; message: string }[] };
export type SyncOutcome = { status: "succeeded"; result: SyncResult; links?: LinkSummary } | { status: "failed"; error: string };

const STALE_RUN_MINUTES = 30;
const MAX_ERROR_LENGTH = 500;
const SAVE_BATCH = 500;
const REMOVE_BATCH = 1000;

const chunks = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

// In LIKE, backslash is the escape character in PostgreSQL. Escape it and the two wildcards.
const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const excluded = (column: { name: string }) => sql`excluded.${sql.identifier(column.name)}`;

function parseCredentials(plaintext: string): Credentials {
  const value: unknown = JSON.parse(plaintext);
  const v = value as Record<string, unknown>;
  if (v?.type === "client_credentials" && typeof v.clientId === "string" && typeof v.clientSecret === "string") {
    return { type: "client_credentials", clientId: v.clientId, clientSecret: v.clientSecret };
  }
  if (v?.type === "static_token" && typeof v.accessToken === "string") {
    return { type: "static_token", accessToken: v.accessToken };
  }
  throw new Error("Saved Shopify credentials are not in the expected format.");
}

export function createShopifyRepository<S extends Record<string, unknown>>(db: NodePgDatabase<S>, encryptionKey: EncryptionKey) {
  const connection = {
    /** Replaces whatever connection exists. There is only ever one. */
    async saveConnection(input: {
      shop: string;
      credentials: Credentials;
      scopes: string[];
      location?: { id: string; name: string } | null;
    }): Promise<void> {
      const sealed = encrypt(JSON.stringify(input.credentials), encryptionKey.key, encryptionKey.keyId);
      const values = {
        shop: input.shop,
        credentialType: input.credentials.type,
        credentialsCiphertext: sealed.ciphertext,
        credentialsIv: sealed.iv,
        credentialsTag: sealed.tag,
        credentialsKeyId: sealed.keyId,
        scopes: input.scopes,
        locationId: input.location?.id ?? null,
        locationName: input.location?.name ?? null,
        status: "connected" as const,
        connectedAt: sql`now()`,
        lastSuccessfulCallAt: null,
      };
      await db
        .insert(shopifyConnection)
        .values({ id: true, ...values })
        .onConflictDoUpdate({ target: shopifyConnection.id, set: values });
    },

    async getConnection(): Promise<ConnectionRecord | null> {
      const [row] = await db
        .select({
          shop: shopifyConnection.shop,
          credentialType: shopifyConnection.credentialType,
          scopes: shopifyConnection.scopes,
          locationId: shopifyConnection.locationId,
          locationName: shopifyConnection.locationName,
          status: shopifyConnection.status,
          connectedAt: shopifyConnection.connectedAt,
          lastSuccessfulCallAt: shopifyConnection.lastSuccessfulCallAt,
        })
        .from(shopifyConnection)
        .limit(1);
      return (row as ConnectionRecord | undefined) ?? null;
    },

    /** Decrypts the saved credentials. For the server's own use. Never send the result to a browser. */
    async getCredentials(): Promise<{ shop: string; credentials: Credentials } | null> {
      const [row] = await db.select().from(shopifyConnection).limit(1);
      if (!row) return null;
      if (row.credentialsKeyId !== encryptionKey.keyId) {
        throw new Error("Saved Shopify credentials use an encryption key this server does not have.");
      }
      const plaintext = decrypt(
        {
          ciphertext: row.credentialsCiphertext,
          iv: row.credentialsIv,
          tag: row.credentialsTag,
          keyId: row.credentialsKeyId,
        },
        encryptionKey.key,
      );
      return { shop: row.shop, credentials: parseCredentials(plaintext) };
    },

    async setLocation(location: { id: string; name: string }): Promise<void> {
      await db.update(shopifyConnection).set({ locationId: location.id, locationName: location.name });
    },

    async setStatus(status: "connected" | "needs_reconnect"): Promise<void> {
      await db.update(shopifyConnection).set({ status });
    },

    async touchSuccess(): Promise<void> {
      await db.update(shopifyConnection).set({ lastSuccessfulCallAt: sql`now()` });
    },

    async deleteConnection(): Promise<void> {
      await db.delete(shopifyConnection);
    },
  };

  const catalogStore = (): CatalogStore => ({
    async getAll(): Promise<StoredVariant[]> {
      const rows = await db.select().from(shopifyVariants);
      return rows.map((r) => ({
        variantId: r.variantId,
        productId: r.productId,
        productTitle: r.productTitle,
        variantTitle: r.variantTitle,
        options: r.options as { name: string; value: string }[],
        sku: r.sku,
        inventoryItemId: r.inventoryItemId,
        tracked: r.tracked,
        inventoryPolicy: r.inventoryPolicy as "DENY" | "CONTINUE",
        available: r.available,
        supplierName: r.supplierName,
        supplierUrl: r.supplierUrl,
        removed: r.removedAt !== null,
      }));
    },

    async save(variants: CatalogVariant[]): Promise<void> {
      for (const batch of chunks(variants, SAVE_BATCH)) {
        await db
          .insert(shopifyVariants)
          .values(
            batch.map((v) => ({
              variantId: v.variantId,
              productId: v.productId,
              productTitle: v.productTitle,
              variantTitle: v.variantTitle,
              options: v.options,
              sku: v.sku,
              inventoryItemId: v.inventoryItemId,
              tracked: v.tracked,
              inventoryPolicy: v.inventoryPolicy,
              available: v.available,
              supplierName: v.supplierName,
              supplierUrl: v.supplierUrl,
              quantityReadAt: sql`now()`,
              syncedAt: sql`now()`,
              removedAt: null,
            })),
          )
          .onConflictDoUpdate({
            target: shopifyVariants.variantId,
            set: {
              productId: excluded(shopifyVariants.productId),
              productTitle: excluded(shopifyVariants.productTitle),
              variantTitle: excluded(shopifyVariants.variantTitle),
              options: excluded(shopifyVariants.options),
              sku: excluded(shopifyVariants.sku),
              inventoryItemId: excluded(shopifyVariants.inventoryItemId),
              tracked: excluded(shopifyVariants.tracked),
              inventoryPolicy: excluded(shopifyVariants.inventoryPolicy),
              available: excluded(shopifyVariants.available),
              supplierName: excluded(shopifyVariants.supplierName),
              supplierUrl: excluded(shopifyVariants.supplierUrl),
              quantityReadAt: sql`now()`,
              syncedAt: sql`now()`,
              removedAt: null, // saving a variant brings it back
            },
          });
      }
    },

    async markRemoved(variantIds: string[]): Promise<void> {
      for (const batch of chunks(variantIds, REMOVE_BATCH)) {
        await db
          .update(shopifyVariants)
          .set({ removedAt: sql`now()` })
          .where(and(inArray(shopifyVariants.variantId, batch), isNull(shopifyVariants.removedAt)));
      }
    },
  });

  const variants = {
    /** One page of variants that still exist in Shopify, with the total that match. */
    /** After the app changed a number in Shopify (or saw a newer one), keep the synced copy in step so suggestions use it. */
    async setAvailable(variantId: string, quantity: number): Promise<void> {
      await db.update(shopifyVariants).set({ available: quantity, quantityReadAt: new Date() }).where(eq(shopifyVariants.variantId, variantId));
    },

    /** What the suggestions need of some variants: the item to change, the last synced number, and whether it is gone. */
    async variantStock(variantIds: string[]): Promise<Map<string, { inventoryItemId: string; available: number | null; tracked: boolean; removed: boolean }>> {
      if (variantIds.length === 0) return new Map();
      const rows = await db
        .select({ id: shopifyVariants.variantId, inventoryItemId: shopifyVariants.inventoryItemId, available: shopifyVariants.available, tracked: shopifyVariants.tracked, removedAt: shopifyVariants.removedAt })
        .from(shopifyVariants)
        .where(inArray(shopifyVariants.variantId, variantIds));
      return new Map(rows.map((r) => [r.id, { inventoryItemId: r.inventoryItemId, available: r.available, tracked: r.tracked, removed: r.removedAt !== null }]));
    },

    async listVariants(opts: { page: number; pageSize: number; search?: string; warningsOnly?: boolean }): Promise<VariantPage> {
      const conditions: (SQL | undefined)[] = [isNull(shopifyVariants.removedAt)];
      if (opts.search) {
        const pattern = likePattern(opts.search);
        conditions.push(
          or(
            ilike(shopifyVariants.productTitle, pattern),
            ilike(shopifyVariants.variantTitle, pattern),
            ilike(shopifyVariants.sku, pattern),
          ),
        );
      }
      if (opts.warningsOnly) {
        conditions.push(or(eq(shopifyVariants.tracked, false), eq(shopifyVariants.inventoryPolicy, "CONTINUE")));
      }
      const where = and(...conditions);

      const [{ total } = { total: 0 }] = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(shopifyVariants)
        .where(where);
      const rows = await db
        .select()
        .from(shopifyVariants)
        .where(where)
        .orderBy(
          asc(sql`lower(${shopifyVariants.productTitle})`),
          asc(sql`lower(${shopifyVariants.variantTitle})`),
          asc(shopifyVariants.variantId),
        )
        .limit(opts.pageSize)
        .offset((opts.page - 1) * opts.pageSize);

      return {
        total,
        page: opts.page,
        pageSize: opts.pageSize,
        items: rows.map((r) => ({
          variantId: r.variantId,
          productId: r.productId,
          productTitle: r.productTitle,
          variantTitle: r.variantTitle,
          options: r.options as { name: string; value: string }[],
          sku: r.sku,
          inventoryItemId: r.inventoryItemId,
          tracked: r.tracked,
          inventoryPolicy: r.inventoryPolicy as "DENY" | "CONTINUE",
          available: r.available,
          syncedAt: r.syncedAt,
        })),
      };
    },
  };

  const syncRuns = {
    /** Starts a run, or returns null if one is already running. A run stuck for over 30 minutes is closed first. */
    async startSyncRun(): Promise<number | null> {
      await db
        .update(shopifySyncRuns)
        .set({ status: "failed", finishedAt: sql`now()`, error: "Interrupted: the sync did not finish." })
        .where(
          and(
            eq(shopifySyncRuns.status, "running"),
            lt(shopifySyncRuns.startedAt, sql`now() - ${`${STALE_RUN_MINUTES} minutes`}::interval`),
          ),
        );
      const [row] = await db.insert(shopifySyncRuns).values({}).onConflictDoNothing().returning({ id: shopifySyncRuns.id });
      return row?.id ?? null;
    },

    /** True while a sync is running. A run left over 30 minutes does not count, matching startSyncRun. */
    async isSyncRunning(): Promise<boolean> {
      const rows = await db
        .select({ id: shopifySyncRuns.id })
        .from(shopifySyncRuns)
        .where(
          and(
            eq(shopifySyncRuns.status, "running"),
            sql`${shopifySyncRuns.startedAt} > now() - ${`${STALE_RUN_MINUTES} minutes`}::interval`,
          ),
        )
        .limit(1);
      return rows.length > 0;
    },

    async finishSyncRun(id: number, outcome: SyncOutcome): Promise<void> {
      if (outcome.status === "succeeded") {
        await db
          .update(shopifySyncRuns)
          .set({ status: "succeeded", finishedAt: sql`now()`, ...outcome.result, links: outcome.links ?? null, error: null })
          .where(eq(shopifySyncRuns.id, id));
      } else {
        await db
          .update(shopifySyncRuns)
          .set({ status: "failed", finishedAt: sql`now()`, error: outcome.error.slice(0, MAX_ERROR_LENGTH) })
          .where(eq(shopifySyncRuns.id, id));
      }
    },

    /** While a sync runs, `total` holds how many variants it has seen so far. The final result replaces it. */
    async updateSyncProgress(id: number, variantsSeen: number): Promise<void> {
      await db
        .update(shopifySyncRuns)
        .set({ total: variantsSeen })
        .where(and(eq(shopifySyncRuns.id, id), eq(shopifySyncRuns.status, "running")));
    },

    async lastSyncRun(): Promise<SyncRunRecord | null> {
      const [row] = await db.select().from(shopifySyncRuns).orderBy(desc(shopifySyncRuns.id)).limit(1);
      return (row as SyncRunRecord | undefined) ?? null;
    },
  };

  return { ...connection, ...variants, ...syncRuns, catalogStore };
}
