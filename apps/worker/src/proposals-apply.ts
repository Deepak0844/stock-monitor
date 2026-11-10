import type { Logger } from "pino";
import type { createAuditWriter } from "@stock-monitor/audit";
import type { createProposalRepository, createShopifyRepository } from "@stock-monitor/db";
import { isConflict, nextAfterUnknown } from "@stock-monitor/proposals";
import type { Queue } from "@stock-monitor/queue";
import {
  createShopifyClient,
  createTokenProvider,
  isShopifyError,
  readAvailable,
  setAvailableQuantity,
  type BaseUrlResolver,
  type ShopifyClientOptions,
} from "@stock-monitor/shopify";

export type ProposalsApplyDeps = {
  proposals: ReturnType<typeof createProposalRepository>;
  shopify: ReturnType<typeof createShopifyRepository>;
  audit: ReturnType<typeof createAuditWriter>;
  queue: Pick<Queue, "enqueue">;
  logger: Logger;
  now?: () => Date;
  /** Test only: points requests at a fake Shopify. */
  baseUrl?: BaseUrlResolver;
  clientOptions?: Partial<Omit<ShopifyClientOptions, "shop" | "tokens" | "baseUrl">>;
};

/**
 * Handles one `proposals.apply` job: writes one approved number to Shopify. The only job that changes Shopify.
 * Before the first send it re-reads the number: if Shopify no longer holds what the suggestion was made from, nothing is written
 * (a conflict, never retried, never overwritten). Every send carries the suggestion's stored idempotency key, so a retry after an
 * unknown outcome, a restart or a lost job can never apply twice. Records and audit events hold numbers and fixed codes only.
 */
export function createProposalsApplyHandler(deps: ProposalsApplyDeps) {
  const { proposals, shopify, audit, queue, logger } = deps;
  const now = deps.now ?? (() => new Date());

  return async function handleApply(payload: { proposalId: string }): Promise<void> {
    const p = await proposals.get(payload.proposalId);
    if (!p || p.state !== "approved" || p.approvedQuantity === null || !p.idempotencyKey) {
      logger.info({ proposalId: payload.proposalId, state: p?.state ?? "missing" }, "proposal apply skipped");
      return;
    }
    const id = p.id;
    const to = p.approvedQuantity;
    // Only the first send compares first. Once an attempt has been counted, Shopify may already hold our number.
    const firstTry = p.attempts === 0;
    const attempts = await proposals.bumpAttempts(id);
    const note = (action: string, extra: Record<string, unknown>) =>
      audit.record({ action: `proposal.${action}`, entityType: "proposal", entityId: id, details: { variantId: p.variantId, from: p.shopifyQuantitySeen, to, ...extra } });

    const fail = async (code: string) => {
      if (await proposals.markFailed(id, code)) await note("failed", { code });
      logger.warn({ proposalId: id, code }, "proposal failed");
    };
    const conflict = async (current: number | null) => {
      if (!(await proposals.markConflict(id, current))) return;
      if (current !== null) await shopify.setAvailable(p.variantId, current);
      await note("conflict", { now: current });
      logger.info({ proposalId: id }, "proposal conflict: Shopify changed");
    };
    const tryLater = async () => {
      const wait = nextAfterUnknown(attempts);
      if (wait === "give_up") return fail("unconfirmed");
      try {
        await queue.enqueue("proposals.apply", { proposalId: id }, { startAfter: wait / 1000, retryLimit: 0 });
      } catch {
        logger.warn({ proposalId: id }, "could not queue the retry; the tick will pick it up"); // still approved
      }
    };

    const saved = await shopify.getCredentials();
    const connection = await shopify.getConnection();
    if (!saved || !connection) return fail("not_connected");
    if (!connection.locationId) return fail("no_location");
    if (!connection.scopes.includes("write_inventory")) return fail("no_permission");
    const variant = (await shopify.variantStock([p.variantId])).get(p.variantId);
    if (!variant || variant.removed) return fail("item_gone");

    const client = createShopifyClient({
      shop: saved.shop,
      tokens: createTokenProvider({ shop: saved.shop, credentials: saved.credentials, baseUrl: deps.baseUrl }),
      baseUrl: deps.baseUrl,
      ...deps.clientOptions,
    });

    try {
      if (firstTry) {
        const current = await readAvailable(client, variant.inventoryItemId, connection.locationId);
        if (isConflict(p.shopifyQuantitySeen, current)) return await conflict(current);
      }
      const sent = await setAvailableQuantity({
        client, inventoryItemId: variant.inventoryItemId, locationId: connection.locationId, quantity: to, changeFromQuantity: p.shopifyQuantitySeen, idempotencyKey: p.idempotencyKey,
      });
      switch (sent.result) {
        case "applied":
          if (await proposals.markApplied(id, sent.newQuantity, now())) {
            await shopify.setAvailable(p.variantId, sent.newQuantity);
            await note("applied", {});
            logger.info({ proposalId: id }, "proposal applied");
          }
          return;
        case "changed":
          return await conflict(await readAvailable(client, variant.inventoryItemId, connection.locationId).catch(() => null));
        case "no_permission":
          return await fail("no_permission");
        case "refused":
          return await fail("refused");
        case "unknown":
          return await tryLater();
      }
    } catch (error) {
      if (!isShopifyError(error)) throw error;
      if (error.code === "no_access") return fail("no_permission");
      if (error.code === "rejected_credentials" || error.code === "store_unavailable") return fail("refused");
      return tryLater(); // the pre-read could not reach Shopify: nothing was sent yet
    }
  };
}
