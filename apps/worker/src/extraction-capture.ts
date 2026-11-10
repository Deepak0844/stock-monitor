import type { Logger } from "pino";
import type { BrowserClient } from "@stock-monitor/browser-client";
import type { createCaptureRepository, createMappingRepository, createSupplierRepository, createSupplierSessionRepository } from "@stock-monitor/db";
import type { PageDescription } from "@stock-monitor/extraction";
import { whyNotChecked } from "@stock-monitor/mapping";
import { unsealSessionState } from "@stock-monitor/supplier-session";

export type CaptureDeps = {
  captures: ReturnType<typeof createCaptureRepository>;
  mappings: ReturnType<typeof createMappingRepository>;
  suppliers: ReturnType<typeof createSupplierRepository>;
  supplierSessions: ReturnType<typeof createSupplierSessionRepository>;
  browser: BrowserClient;
  /** Opens saved sessions. The browser service never has it. */
  key: Buffer;
  logger: Logger;
};
export type CaptureOutcome = { kind: "skipped" } | { kind: "ready" } | { kind: "failed"; reason: string };

// A page that is a login, a puzzle, a block or nothing at all is not a product page to write rules from.
const NOT_A_PAGE = new Set(["login_required", "captcha", "blocked", "unreachable"]);

/**
 * Fills a pending capture: opens the link's page with the supplier's saved session and stores what the browser showed.
 * A failure is a fixed reason code, never a message. Nothing about the page or the session is logged.
 */
export async function handleCapture(deps: CaptureDeps, captureId: string): Promise<CaptureOutcome> {
  const { captures, mappings, suppliers, supplierSessions, browser, logger } = deps;
  const capture = await captures.get(captureId);
  // Gone, or already done: a repeated job changes nothing.
  if (!capture || capture.status !== "pending") return { kind: "skipped" };
  const fail = async (reason: string): Promise<CaptureOutcome> => {
    await captures.fill(captureId, { status: "failed", failureReason: reason });
    logger.info({ captureId, outcome: "failed", reason }, "capture finished");
    return { kind: "failed", reason };
  };

  const supplier = await suppliers.get(capture.supplierId);
  if (!supplier) return { kind: "skipped" };
  const sealed = await supplierSessions.getSealed(supplier.id);
  const refused = whyNotChecked(supplier, sealed !== null);
  if (refused) return fail(refused.reason);
  const mapping = capture.mappingId ? await mappings.get(capture.mappingId) : null;
  if (!mapping) return fail("link_not_found");

  let state;
  try {
    state = unsealSessionState(sealed as NonNullable<typeof sealed>, deps.key);
  } catch {
    return fail("session_unreadable");
  }
  const outcome = await browser.capture({ url: mapping.url, loginUrl: supplier.loginUrl ?? undefined, state, picture: true });
  if (!outcome.ok) return fail("browser_unavailable");
  if (NOT_A_PAGE.has(outcome.result)) return fail(outcome.result);

  const description: PageDescription = {
    url: outcome.finalUrl ?? mapping.url,
    title: outcome.title ?? "",
    status: outcome.status,
    pageClass: outcome.result,
    sections: outcome.description.sections,
    buttons: outcome.description.buttons,
  };
  await captures.fill(captureId, { status: "ready", pageClass: outcome.result, description, picture: outcome.picture });
  logger.info({ captureId, outcome: "ready" }, "capture finished");
  return { kind: "ready" };
}

/** The `extraction.capture` job. Its payload is only the capture's id. */
export const createCaptureHandler = (deps: CaptureDeps) => async (payload: { captureId: string }): Promise<void> => void (await handleCapture(deps, payload.captureId));
