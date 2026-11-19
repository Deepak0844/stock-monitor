import type { SupplierRecord } from "@stock-monitor/db";
import type { SessionState } from "@stock-monitor/supplier-session";

/** The session a supplier that needs no login is visited with: nothing at all. */
export const EMPTY_STATE: SessionState = { cookies: [], origins: [] };

/**
 * The login address and logged-in marker a page visit sends. A supplier that needs no login sends neither, and says its page
 * is public, so wording like "log in to see prices" is not taken as a login wall.
 */
export const loginFields = (supplier: Pick<SupplierRecord, "needsLogin" | "loginUrl" | "loggedInMarker">): { loginUrl?: string; loggedInMarker?: string; publicPage?: true } =>
  supplier.needsLogin ? { loginUrl: supplier.loginUrl ?? undefined, ...(supplier.loggedInMarker ? { loggedInMarker: supplier.loggedInMarker } : {}) } : { publicPage: true };
