import type { createNotificationRepository, createSupplierRepository, NotificationReason } from "@stock-monitor/db";

/** The reasons a session needs attention. (The other reason, page_changed, belongs to stock rules.) */
export type AttentionReason = Exclude<NotificationReason, "page_changed">;

/** Why a run ended before every link was looked at. */
export type StopReason = "login_required" | "captcha" | "blocked" | "unreachable" | "supplier_not_ready";

// What the owner reads. Plain words, and the supplier's name, never an exception name or a secret.
const MESSAGES: Record<AttentionReason, (name: string) => string> = {
  login_required: (name) => `${name} needs you to log in again.`,
  captcha: (name) => `${name} is asking you to solve a puzzle (a CAPTCHA). Log in again to solve it.`,
  blocked: (name) => `${name} is refusing our automated checks, even though your login may have worked. It stays paused. Ask the supplier for a price list or feed, or reconnect to try again.`,
  unknown: (name) => `We could not tell whether ${name} is still logged in. Reconnect the supplier to be sure.`,
  code_required: () => "The supplier asked for a code. Log in in the live window and type it there.",
  wrong_password: () => "The supplier refused the saved password. Automatic login is paused until you save it again.",
  account_locked: () => "The supplier says the account is locked. Automatic login is paused. Unlock it on the supplier's site, then press Resume.",
  form_not_found: () => "Automatic login could not find the login form. Set the login page fields on the supplier page.",
};

/** A challenge or a block is shown as Blocked. A login or an unclear page as Needs reconnecting. */
const STATUS = {
  login_required: "needs_reconnect",
  unknown: "needs_reconnect",
  captcha: "blocked",
  blocked: "blocked",
  code_required: "needs_reconnect",
  wrong_password: "needs_reconnect",
  form_not_found: "needs_reconnect",
  account_locked: "blocked",
} as const;

/** Marks the supplier as needing attention and tells the owner on the dashboard. Used by session checks and by stock runs that meet a login, puzzle or block. */
export async function raiseNeedsAttention(
  deps: { suppliers: ReturnType<typeof createSupplierRepository>; notifications: ReturnType<typeof createNotificationRepository> },
  supplier: { id: string; name: string; needsLogin?: boolean },
  result: AttentionReason,
): Promise<void> {
  await deps.suppliers.markNeedsAttention(supplier.id, STATUS[result]);
  // "Log in again" makes no sense for a supplier set to need no login: the setting may be wrong, so say that.
  const message =
    supplier.needsLogin === false && result === "login_required"
      ? `${supplier.name} showed a login page, but it is set to need no login. Open one of its links to see why, or turn Needs a login back on.`
      : MESSAGES[result](supplier.name);
  await deps.notifications.raise({ kind: "supplier_needs_reconnect", supplierId: supplier.id, message, reason: result });
}
