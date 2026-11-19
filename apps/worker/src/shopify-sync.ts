import type { Logger } from "pino";
import type { LinkSummary, createMappingRepository, createShopifyRepository, createSupplierRepository } from "@stock-monitor/db";
import { planShopifyLinks, supplierMatchName } from "@stock-monitor/mapping";
import type { Queue } from "@stock-monitor/queue";
import {
  createShopifyClient,
  createTokenProvider,
  ensureWebhookSubscriptions,
  isShopifyError,
  syncCatalog,
  type BaseUrlResolver,
  type SupplierMetafields,
  type ShopifyClientOptions,
} from "@stock-monitor/shopify";

type Repository = ReturnType<typeof createShopifyRepository>;

const MAX_PROBLEMS = 20;
/** Changes that arrive close together are folded into one sync per this many seconds. */
export const SYNC_GROUP_SECONDS = 60;

/** Where Shopify sends change messages. Shopify only sends to https, so on plain http (localhost) there is none. */
export function webhookUrlFor(appOrigin: string | undefined): string | undefined {
  return appOrigin?.startsWith("https://") ? `${appOrigin}/api/shopify/webhooks` : undefined;
}

export type ShopifySyncDeps = {
  repo: Repository;
  /** With both of these, a sync also sets each variant's link from the supplier name and page address Shopify holds. */
  mappings?: ReturnType<typeof createMappingRepository>;
  suppliers?: ReturnType<typeof createSupplierRepository>;
  /** Which product metafields hold the supplier's name and page address. Defaults to custom.supplier_name and custom.spu. */
  metafields?: SupplierMetafields;
  logger: Logger;
  /** With this, a sync that finds another one running queues a grouped follow-up, so no change is missed. */
  queue?: Pick<Queue, "enqueue">;
  /** With this, each successful sync makes sure Shopify sends its change messages here. See webhookUrlFor. */
  webhookUrl?: string;
  /** Test only: points requests at a fake Shopify. */
  baseUrl?: BaseUrlResolver;
  clientOptions?: Partial<Omit<ShopifyClientOptions, "shop" | "tokens" | "baseUrl">>;
};

const NOT_CONNECTED = "Connect Shopify first.";
const NO_LOCATION = "Choose an inventory location first.";
const UNEXPECTED = "Something went wrong while syncing. Try again.";

/**
 * Handles one `shopify.sync` job. Everything it needs comes from the database, so the job carries
 * no data. Expected problems are recorded on the run and never thrown, so the queue does not retry
 * them: the owner sees the message and presses Sync again.
 */
export function createShopifySyncHandler(deps: ShopifySyncDeps) {
  const { repo, logger } = deps;

  /**
   * After the variants are saved: every variant whose product has a supplier name and a page address in Shopify gets its one link
   * from them. Shopify is the one source. A pair that cannot be used is skipped and listed, never guessed at. A failure here does
   * not fail the sync: it is reported on the run, and the next sync tries again.
   */
  async function setLinksFromShopify(): Promise<LinkSummary | undefined> {
    const { mappings, suppliers } = deps;
    if (!mappings || !suppliers) return undefined;
    try {
      const supplierList = await suppliers.list();
      const byName = new Map(supplierList.map((s) => [supplierMatchName(s), { id: s.id, host: new URL(s.websiteUrl).hostname }]));
      const plan = planShopifyLinks(await mappings.shopifyLinkSources(), byName);
      const saved = await mappings.upsertFromShopify(plan.rows);
      return { added: saved.created, updated: saved.updated, skipped: plan.problems.length, problems: plan.problems.slice(0, MAX_PROBLEMS) };
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, "setting links from Shopify failed");
      return { added: 0, updated: 0, skipped: 0, problems: [{ product: "All products", sku: null, message: "Links could not be set from Shopify this time. Sync again." }] };
    }
  }

  /** Never fails the sync: the next sync tries again. */
  async function signUpForChanges(client: ReturnType<typeof createShopifyClient>, uri: string) {
    try {
      const { created } = await ensureWebhookSubscriptions(client, uri);
      if (created.length > 0) logger.info({ created }, "signed up for Shopify change messages");
    } catch (error) {
      logger.warn({ code: isShopifyError(error) ? error.code : undefined }, "signing up for Shopify change messages failed; the next sync tries again");
    }
  }

  return async function handleShopifySync(_payload: unknown): Promise<void> {
    const runId = await repo.startSyncRun();
    if (runId === null) {
      // A change may have landed after the running sync read it, so read again once that one is done.
      await deps.queue?.enqueue("shopify.sync", {}, { groupSeconds: SYNC_GROUP_SECONDS });
      logger.info("shopify sync skipped: a sync is already running, one more is queued");
      return;
    }
    const fail = (message: string) => repo.finishSyncRun(runId, { status: "failed", error: message });

    try {
      const saved = await repo.getCredentials();
      if (!saved) return await fail(NOT_CONNECTED);
      const connection = await repo.getConnection();
      if (!connection?.locationId) return await fail(NO_LOCATION);

      const tokens = createTokenProvider({ shop: saved.shop, credentials: saved.credentials, baseUrl: deps.baseUrl });
      const client = createShopifyClient({ shop: saved.shop, tokens, baseUrl: deps.baseUrl, ...deps.clientOptions });

      const result = await syncCatalog({
        client,
        locationId: connection.locationId,
        store: repo.catalogStore(),
        metafields: deps.metafields,
        onProgress: (progress) => repo.updateSyncProgress(runId, progress.variantsSeen),
      });

      const links = await setLinksFromShopify();
      await repo.finishSyncRun(runId, { status: "succeeded", result, links });
      await repo.setStatus("connected");
      await repo.touchSuccess();
      logger.info({ runId, ...result }, "shopify sync finished");
      // Only a client ID + secret connection can have its messages checked: the secret signs them.
      if (deps.webhookUrl && saved.credentials.type === "client_credentials") await signUpForChanges(client, deps.webhookUrl);
    } catch (error) {
      if (isShopifyError(error)) {
        await fail(error.message);
        // These two mean the saved connection no longer works, so the owner has to reconnect.
        if (error.code === "rejected_credentials" || error.code === "wrong_organization") {
          await repo.setStatus("needs_reconnect");
        }
        logger.warn({ runId, code: error.code }, "shopify sync failed");
      } else {
        await fail(UNEXPECTED);
        logger.error({ runId, error: error instanceof Error ? error.message : String(error) }, "shopify sync failed");
      }
    }
  };
}
