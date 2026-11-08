import { and, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
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
};

export type SyncOutcome = { status: "succeeded"; result: SyncResult } | { status: "failed"; error: string };

const STALE_RUN_MINUTES = 30;
const MAX_ERROR_LENGTH = 500;
const SAVE_BATCH = 500;
const REMOVE_BATCH = 1000;

const chunks = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

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

    async finishSyncRun(id: number, outcome: SyncOutcome): Promise<void> {
      if (outcome.status === "succeeded") {
        await db
          .update(shopifySyncRuns)
          .set({ status: "succeeded", finishedAt: sql`now()`, ...outcome.result, error: null })
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

  return { ...connection, ...syncRuns, catalogStore };
}
