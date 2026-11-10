import type { FastifyInstance, RawReplyDefaultExpression, RawRequestDefaultExpression, RawServerDefault } from "fastify";
import type { Logger } from "pino";
import { z } from "zod";
import type { createAuditWriter } from "@stock-monitor/audit";
import type { createProposalRepository, createShopifyRepository, ProposalView } from "@stock-monitor/db";
import { MAX_QUANTITY, validateQuantity } from "@stock-monitor/proposals";
import type { Queue } from "@stock-monitor/queue";
import { AppError } from "../errors.js";

type App = FastifyInstance<RawServerDefault, RawRequestDefaultExpression, RawReplyDefaultExpression, Logger>;
type Audit = ReturnType<typeof createAuditWriter>;

export type ProposalRoutesDeps = {
  proposals: ReturnType<typeof createProposalRepository>;
  shopify: ReturnType<typeof createShopifyRepository>;
  queue: Pick<Queue, "enqueue">;
  now?: () => Date;
};

const NO_PERMISSION = "Shopify has not given this app permission to change stock yet.";
const NOT_TRACKED = "Shopify is not tracking stock for this item, so changing the quantity would have no effect.";
const NOT_FOUND = () => new AppError(404, "proposal_not_found", "That suggestion does not exist.");

const approveBody = z.object({ quantity: z.number().optional() }).strict();
const rejectBody = z.object({ note: z.string().max(500).optional() }).strict();
const settingsBody = z
  .object({ defaultQuantity: z.number().int().min(1).max(MAX_QUANTITY), expiryHours: z.number().int().min(1).max(720) })
  .strict();
const listQuery = z.object({
  tab: z.enum(["open", "history"]).default("open"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

/** What the screen may see of a suggestion. Never the idempotency key, who decided, or the attempt count. */
const present = (p: ProposalView) => ({
  id: p.id,
  state: p.state,
  kind: p.kind,
  productTitle: p.productTitle,
  variantTitle: p.variantTitle,
  sku: p.sku,
  supplierName: p.supplierName,
  shopifyQuantitySeen: p.shopifyQuantitySeen,
  proposedQuantity: p.proposedQuantity,
  approvedQuantity: p.approvedQuantity,
  edited: p.edited,
  createdAt: p.createdAt,
  expiresAt: p.expiresAt,
  decidedAt: p.decidedAt,
  appliedAt: p.appliedAt,
  note: p.note,
  closedReason: p.closedReason,
  resultCode: p.resultCode,
  resultQuantity: p.resultQuantity,
  observed: p.observedAnswer ? { answer: p.observedAnswer, reason: p.observedReason, at: p.observedAt } : null,
  tracked: p.tracked,
  continueSelling: p.inventoryPolicy === "CONTINUE",
  blockedReason: p.tracked ? null : NOT_TRACKED,
});

const DECIDED: Record<string, string> = {
  approved: "This suggestion was already approved and is waiting for Shopify.",
  applied: "This suggestion was already applied.",
  rejected: "This suggestion was already rejected.",
  conflict: "Shopify's number changed, so this suggestion was not applied. Wait for the next check.",
  failed: "This suggestion could not be applied.",
  replaced: "A newer check replaced this suggestion.",
  expired: "This suggestion expired. The next check will make a new one if it still applies.",
};

/** Suggestions: list, approve, reject and the two settings. Approving only records the decision and queues one job; the worker writes to Shopify. */
export function registerProposalRoutes(app: App, deps: ProposalRoutesDeps, audit: Audit): void {
  const { proposals, shopify, queue } = deps;
  const now = deps.now ?? (() => new Date());

  const record = (request: { user: { id: string } | null; id: string }, action: string, id: string, details: Record<string, unknown>) =>
    audit.record({ actorUserId: request.user?.id, action, entityType: "proposal", entityId: id, details, requestId: request.id });

  async function writePermission(): Promise<{ state: "ready" | "missing" | "not_connected"; message: string }> {
    const connection = await shopify.getConnection();
    if (!connection) return { state: "not_connected", message: "Connect Shopify first." };
    return connection.scopes.includes("write_inventory")
      ? { state: "ready", message: "Shopify allows this app to change stock." }
      : { state: "missing", message: NO_PERMISSION };
  }

  const stateError = (state: string) =>
    new AppError(409, state === "expired" ? "expired" : "already_decided", DECIDED[state] ?? "This suggestion can no longer be decided.");

  app.get("/api/proposals", async (request) => {
    const query = listQuery.safeParse(request.query);
    if (!query.success) throw new AppError(400, "bad_request", "The request was not valid.");
    const { tab, page, pageSize } = query.data;
    const permission = await writePermission();
    if (tab === "open") return { proposals: (await proposals.open()).map(present), writePermission: permission };
    const rows = await proposals.history(pageSize + 1, (page - 1) * pageSize);
    return { proposals: rows.slice(0, pageSize).map(present), hasMore: rows.length > pageSize, page, writePermission: permission };
  });

  app.get("/api/proposals/count", async () => ({ open: (await proposals.open()).filter((p) => p.state === "open").length }));

  app.post<{ Params: { id: string } }>("/api/proposals/:id/approve", async (request) => {
    const body = approveBody.safeParse(request.body ?? {});
    if (!body.success) throw new AppError(400, "invalid_quantity", "Enter a whole number.");
    const current = await proposals.getView(request.params.id);
    if (!current) throw NOT_FOUND();
    if (current.state !== "open") throw stateError(current.state);
    if (current.expiresAt.getTime() <= now().getTime()) throw stateError("expired");
    if ((await writePermission()).state !== "ready") throw new AppError(409, "no_write_permission", NO_PERMISSION);
    if (!current.tracked) throw new AppError(409, "not_tracked", NOT_TRACKED);
    const quantity = body.data.quantity ?? current.proposedQuantity;
    const invalid = validateQuantity(quantity);
    if (invalid) throw new AppError(400, "invalid_quantity", invalid);

    const approved = await proposals.markApproved(current.id, quantity, request.user?.id ?? "owner", now());
    if (!approved) throw stateError("approved"); // someone else pressed first
    await record(request, "proposal.approved", approved.id, { variantId: approved.variantId, from: approved.shopifyQuantitySeen, to: quantity, edited: approved.edited });
    // If the queue is down the suggestion stays approved and the worker's tick queues it again.
    await queue.enqueue("proposals.apply", { proposalId: approved.id }, { retryLimit: 0 }).catch((error) => request.log.warn({ err: error }, "could not queue the apply job"));
    return { proposal: present((await proposals.getView(approved.id))!) };
  });

  app.post<{ Params: { id: string } }>("/api/proposals/:id/reject", async (request) => {
    const body = rejectBody.safeParse(request.body ?? {});
    if (!body.success) throw new AppError(400, "invalid_note", "Keep the note under 500 characters.");
    const current = await proposals.getView(request.params.id);
    if (!current) throw NOT_FOUND();
    if (current.state !== "open") throw stateError(current.state);
    const note = body.data.note?.trim() || null;
    if (!(await proposals.reject(current.id, note, request.user?.id ?? "owner", now()))) throw stateError("approved");
    await record(request, "proposal.rejected", current.id, { variantId: current.variantId, hasNote: note !== null });
    return { proposal: present((await proposals.getView(current.id))!) };
  });

  app.get("/api/settings/proposals", async () => ({ settings: await proposals.settings(), writePermission: await writePermission() }));

  app.put("/api/settings/proposals", async (request) => {
    const body = settingsBody.safeParse(request.body);
    if (!body.success) throw new AppError(400, "invalid_settings", `Enter a default quantity from 1 to ${MAX_QUANTITY} and an expiry from 1 to 720 hours.`);
    await proposals.saveSettings(body.data);
    await audit.record({ actorUserId: request.user?.id, action: "proposals.settings_changed", entityType: "settings", details: body.data, requestId: request.id });
    return { settings: body.data, writePermission: await writePermission() };
  });
}
