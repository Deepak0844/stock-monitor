import type { Logger } from "pino";
import type { createShopifyRepository } from "@stock-monitor/db";
import {
  createShopifyClient,
  createTokenProvider,
  isShopifyError,
  syncCatalog,
  type BaseUrlResolver,
  type ShopifyClientOptions,
} from "@stock-monitor/shopify";

type Repository = ReturnType<typeof createShopifyRepository>;

export type ShopifySyncDeps = {
  repo: Repository;
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
        onProgress: (progress) => repo.updateSyncProgress(runId, progress.variantsSeen),
      });

      await repo.finishSyncRun(runId, { status: "succeeded", result });
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
