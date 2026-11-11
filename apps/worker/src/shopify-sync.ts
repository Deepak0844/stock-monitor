import type { Logger } from "pino";
import type { LinkSummary, createMappingRepository, createShopifyRepository, createSupplierRepository } from "@stock-monitor/db";
import { planShopifyLinks } from "@stock-monitor/mapping";
import {
  createShopifyClient,
  createTokenProvider,
  isShopifyError,
  syncCatalog,
  type BaseUrlResolver,
  type SupplierMetafields,
  type ShopifyClientOptions,
} from "@stock-monitor/shopify";

type Repository = ReturnType<typeof createShopifyRepository>;

const MAX_PROBLEMS = 20;

export type ShopifySyncDeps = {
  repo: Repository;
  /** With both of these, a sync also sets each variant's link from the supplier name and page address Shopify holds. */
  mappings?: ReturnType<typeof createMappingRepository>;
  suppliers?: ReturnType<typeof createSupplierRepository>;
  /** Which product metafields hold the supplier's name and page address. Defaults to custom.supplier_name and custom.spu. */
  metafields?: SupplierMetafields;
  logger: Logger;
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
      const byName = new Map(supplierList.map((s) => [s.name.trim().toLowerCase(), { id: s.id, host: new URL(s.websiteUrl).hostname }]));
      const plan = planShopifyLinks(await mappings.shopifyLinkSources(), byName);
      const saved = await mappings.upsertFromShopify(plan.rows);
      return { added: saved.created, updated: saved.updated, skipped: plan.problems.length, problems: plan.problems.slice(0, MAX_PROBLEMS) };
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : String(error) }, "setting links from Shopify failed");
      return { added: 0, updated: 0, skipped: 0, problems: [{ product: "All products", sku: null, message: "Links could not be set from Shopify this time. Sync again." }] };
    }
  }

  return async function handleShopifySync(_payload: unknown): Promise<void> {
    const runId = await repo.startSyncRun();
    if (runId === null) {
      logger.info("shopify sync skipped: a sync is already running");
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
