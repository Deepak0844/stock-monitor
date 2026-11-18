import type { SupplierRecord } from "@stock-monitor/db";
import type { SessionState } from "@stock-monitor/supplier-session";

/** The session a supplier that needs no login is visited with: nothing at all. */
export const EMPTY_STATE: SessionState = { cookies: [], origins: [] };

/** The login address and logged-in marker a page visit sends. None for a supplier that needs no login. */
export const loginFields = (supplier: Pick<SupplierRecord, "needsLogin" | "loginUrl" | "loggedInMarker">): { loginUrl?: string; loggedInMarker?: string } =>
  supplier.needsLogin ? { loginUrl: supplier.loginUrl ?? undefined, ...(supplier.loggedInMarker ? { loggedInMarker: supplier.loggedInMarker } : {}) } : {};
