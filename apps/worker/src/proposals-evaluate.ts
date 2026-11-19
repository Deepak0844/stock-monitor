import type { Logger } from "pino";
import type { createMappingRepository, createObservationRepository, createProposalRepository, createShopifyRepository } from "@stock-monitor/db";
import { isUnavailableCandidate } from "@stock-monitor/mapping";
import { decideProposal, expiresAt } from "@stock-monitor/proposals";

export type ProposalsEvaluateDeps = {
  mappings: ReturnType<typeof createMappingRepository>;
  observations: ReturnType<typeof createObservationRepository>;
  shopify: ReturnType<typeof createShopifyRepository>;
  proposals: ReturnType<typeof createProposalRepository>;
  logger: Logger;
  now?: () => Date;
};

/**
 * Handles one `proposals.evaluate` job: for each link in scope, takes the latest observation and the last synced Shopify number,
 * applies the rules, and creates, keeps, replaces or closes that variant's one open suggestion. Safe to repeat and to run twice at
 * once. It never visits a supplier and never writes to Shopify.
 */
export function createProposalsEvaluateHandler(deps: ProposalsEvaluateDeps) {
  const { mappings, observations, shopify, proposals, logger } = deps;
  const now = deps.now ?? (() => new Date());

  return async function handleEvaluate(payload: { supplierId?: string; mappingId?: string }): Promise<{ created: number; replaced: number; closed: number }> {
    const tally = { created: 0, replaced: 0, closed: 0 };
    const connection = await shopify.getConnection();
    if (!connection?.locationId) return tally; // nothing can be suggested without a chosen location

    const links = payload.mappingId
      ? [await mappings.get(payload.mappingId)].filter((m) => m !== null)
      : payload.supplierId
        ? await mappings.forSupplier(payload.supplierId)
        : await mappings.list({});
    if (links.length === 0) return tally;

    const latest = await observations.latestByMapping();
    const settings = await proposals.settings();
    const variants = await shopify.variantStock([...new Set(links.map((m) => m.variantId))]);
    const expires = expiresAt(now(), settings.expiryHours);

    for (const link of links) {
      const variant = variants.get(link.variantId);
      const seen = latest.get(link.id);
      const gone = !link.enabled || link.variantRemoved || !variant || variant.removed;
      const wanted =
        gone || !seen || variant.available === null
          ? null
          : decideProposal({
              answer: seen.answer,
              reason: seen.reason,
              quantityMismatch: seen.quantityMismatch,
              shopifyQuantity: variant.available,
              mayBeUnavailable: isUnavailableCandidate(
                { status: link.linkStatus, lastWorkedAt: link.lastWorkedAt, workedTitle: link.workedTitle, workedHeading: link.workedHeading, missingChecks: link.missingChecks, firstMissingAt: link.firstMissingAt, checkedAt: link.lastLinkCheckAt },
                false,
              ),
              defaultQuantity: settings.defaultQuantity,
            });
      const result = await proposals.evaluateFor({
        variantId: link.variantId,
        mappingId: link.id,
        supplierId: link.supplierId,
        observationId: seen?.id ?? null,
        shopifyQuantitySeen: variant?.available ?? 0,
        wanted,
        expiresAt: expires,
        closeReason: gone ? "link_off" : seen?.answer === "cannot_tell" ? "could_not_tell" : "no_longer_needed",
      });
      if (result.change === "created") tally.created += 1;
      else if (result.change === "replaced") tally.replaced += 1;
      else if (result.change === "closed") tally.closed += 1;
    }
    logger.info({ ...tally, links: links.length }, "proposals evaluated");
    return tally;
  };
}
