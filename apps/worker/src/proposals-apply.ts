import type { Logger } from "pino";
import type { createAuditWriter } from "@stock-monitor/audit";
import type { createNotificationRepository, createProposalRepository, createShopifyRepository } from "@stock-monitor/db";
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
  notifications: ReturnType<typeof createNotificationRepository>;
  queue: Pick<Queue, "enqueue">;
  logger: Logger;
  now?: () => Date;
  /** Test only: points requests at a fake Shopify. */
  baseUrl?: BaseUrlResolver;
  clientOptions?: Partial<Omit<ShopifyClientOptions, "shop" | "tokens" | "baseUrl">>;
};

const LEASE_MS = 2 * 60_000;
/** When Shopify could not be reached before anything was sent, try again this many seconds later. Nothing is used up, however long it lasts. */
const UNREACHABLE_RETRY_SECONDS = 300;

/**
 * Handles one `proposals.apply` job: writes one approved number to Shopify. The only job that changes Shopify.
 * One job at a time holds a suggestion (a short lease), so a retry, the tick and a restart cannot send it together.
 * Before the first send it re-reads the number: if Shopify no longer holds what the suggestion was made from, nothing is written
 * (a conflict, never retried, never overwritten). Every send carries the suggestion's stored idempotency key. When the outcome of a
 * send is unclear (the reply was lost), the app looks at Shopify's number instead of guessing: the target means it was applied,
 * the old number means it did not happen and is tried again (10 s, 1 min, 5 min), anything else is a conflict. If Shopify cannot
 * be reached at all it stays approved and waiting. Records and audit events hold numbers and fixed codes only.
 */
export function createProposalsApplyHandler(deps: ProposalsApplyDeps) {
  const { proposals, shopify, audit, notifications, queue, logger } = deps;
  const now = deps.now ?? (() => new Date());

  return async function handleApply(payload: { proposalId: string }): Promise<void> {
    const p = await proposals.claimApply(payload.proposalId, now(), LEASE_MS);
    if (!p || p.approvedQuantity === null || !p.idempotencyKey) {
      logger.info({ proposalId: payload.proposalId }, "proposal apply skipped");
      return;
    }
    try {
      await apply(p as typeof p & { approvedQuantity: number; idempotencyKey: string });
    } finally {
      await proposals.releaseApply(p.id);
    }
  };

  async function apply(p: { id: string; supplierId: string; variantId: string; shopifyQuantitySeen: number; approvedQuantity: number; idempotencyKey: string; attempts: number }): Promise<void> {
    const id = p.id;
    const to = p.approvedQuantity;
    const seen = p.shopifyQuantitySeen;
    // Only the first send compares first. Once a send has been counted, Shopify may already hold our number.
    const firstTry = p.attempts === 0;
    const note = (action: string, extra: Record<string, unknown>) =>
      audit.record({ action: `proposal.${action}`, entityType: "proposal", entityId: id, details: { variantId: p.variantId, from: seen, to, ...extra } });

    // One notice on the Dashboard per supplier when a change was not applied; applying a change for that supplier closes it.
    const warn = (message: string) => notifications.raise({ kind: "proposal_needs_attention", supplierId: p.supplierId, message, reason: "unknown" });
    const fail = async (code: string) => {
      if (await proposals.markFailed(id, code)) {
        await note("failed", { code });
        await warn("A stock change could not be applied to Shopify. Open Proposals to see why.");
      }
      logger.warn({ proposalId: id, code }, "proposal failed");
    };
    const applied = async () => {
      if (!(await proposals.markApplied(id, to, now()))) return;
      await notifications.resolve("proposal_needs_attention", p.supplierId);
      await shopify.setAvailable(p.variantId, to);
      await note("applied", {});
      logger.info({ proposalId: id }, "proposal applied");
    };
    const conflict = async (current: number | null) => {
      if (!(await proposals.markConflict(id, current))) return;
      if (current !== null) await shopify.setAvailable(p.variantId, current);
      await note("conflict", { now: current });
      await warn("A stock change was not applied because Shopify's number changed. Open Proposals to refresh it.");
      logger.info({ proposalId: id }, "proposal conflict: Shopify changed");
    };
    const later = async (seconds: number) => {
      try {
        await queue.enqueue("proposals.apply", { proposalId: id }, { startAfter: seconds, retryLimit: 0 });
      } catch {
        logger.warn({ proposalId: id }, "could not queue the retry; the tick will pick it up"); // still approved
      }
    };

    const view = await proposals.getView(id);
    const saved = await shopify.getCredentials();
    const connection = await shopify.getConnection();
    if (!saved || !connection) return fail("not_connected");
    if (!connection.locationId) return fail("no_location");
    if (!connection.scopes.includes("write_inventory")) return fail("no_permission");
    if (view && !view.mappingEnabled) return fail("link_off");
    const variant = (await shopify.variantStock([p.variantId])).get(p.variantId);
    if (!variant || variant.removed) return fail("item_gone");

    const client = createShopifyClient({
      shop: saved.shop,
      tokens: createTokenProvider({ shop: saved.shop, credentials: saved.credentials, baseUrl: deps.baseUrl }),
      baseUrl: deps.baseUrl,
      ...deps.clientOptions,
    });
    /** Shopify's number now: a number, null when not stocked there, or "unreachable". Anything else (permission, credentials) fails the suggestion. */
    const readNow = async (): Promise<number | null | "unreachable"> => {
      try {
        return await readAvailable(client, variant.inventoryItemId, connection.locationId!);
      } catch (error) {
        if (!isShopifyError(error)) throw error;
        if (error.code === "no_access" || error.code === "rejected_credentials" || error.code === "store_unavailable") throw error;
        return "unreachable";
      }
    };

    try {
      if (firstTry) {
        const current = await readNow();
        if (current === "unreachable") return await later(UNREACHABLE_RETRY_SECONDS); // nothing sent, nothing used up
        if (isConflict(seen, current)) return await conflict(current);
      }
      const attempts = await proposals.bumpAttempts(id);
      const sent = await setAvailableQuantity({
        client,
        inventoryItemId: variant.inventoryItemId,
        locationId: connection.locationId,
        quantity: to,
        changeFromQuantity: seen,
        idempotencyKey: p.idempotencyKey,
        referenceDocumentUri: `gid://stock-monitor/Proposal/${id}`,
      });
      switch (sent.result) {
        case "applied":
          return await applied();
        case "changed": {
          // On the first send this is a real conflict. After an earlier send, Shopify may already hold our number.
          const current = attempts > 1 ? await readNow() : await readNow().catch(() => null);
          if (current === to) return await applied();
          return await conflict(typeof current === "number" ? current : null);
        }
        case "no_permission":
          return await fail("no_permission");
        case "refused":
          return await fail("refused");
        case "unknown": {
          const current = await readNow();
          if (current === to) return await applied(); // it happened, only the reply was lost
          if (current === "unreachable" || current === seen) {
            const wait = nextAfterUnknown(attempts); // it did not happen, or we cannot tell: try again with the same key
            return wait === "give_up" ? await fail("unconfirmed") : await later(wait / 1000);
          }
          return await conflict(current); // some other number: someone else changed it
        }
      }
    } catch (error) {
      if (!isShopifyError(error)) throw error;
      return error.code === "no_access" ? fail("no_permission") : fail("refused");
    }
  }
}
