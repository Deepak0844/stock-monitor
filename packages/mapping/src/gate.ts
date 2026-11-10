export type CheckGateReason = "no_permission" | "not_connected" | "paused" | "needs_attention";
export type SupplierGate = {
  enabled: boolean;
  pausedReason: "owner" | "session" | null;
  sessionStatus: string;
  automationPermission: string;
};

const MESSAGES: Record<CheckGateReason, string> = {
  no_permission: "You have not recorded permission to check this supplier automatically. Open the supplier to record it.",
  not_connected: "This supplier is not connected. Connect it first.",
  paused: "This supplier is paused. Resume it first.",
  needs_attention: "This supplier needs your attention (see its notification) before its links can be checked.",
};

/**
 * Why a supplier's links must not be checked right now, in plain words, or null when they may be. Used by the
 * API before it queues a check and again by the worker, because the supplier can change while a check waits.
 */
export function whyNotChecked(supplier: SupplierGate, hasSession: boolean): { reason: CheckGateReason; message: string } | null {
  const refuse = (reason: CheckGateReason) => ({ reason, message: MESSAGES[reason] });
  if (supplier.automationPermission !== "granted") return refuse("no_permission");
  if (!hasSession || supplier.sessionStatus === "not_connected") return refuse("not_connected");
  if (!supplier.enabled) return refuse(supplier.pausedReason === "session" ? "needs_attention" : "paused");
  return null;
}
