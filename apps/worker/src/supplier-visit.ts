import type { SupplierRecord } from "@stock-monitor/db";
import type { Recipe } from "@stock-monitor/extraction";
import type { SessionState } from "@stock-monitor/supplier-session";

/** The session a supplier that needs no login is visited with: nothing at all. */
export const EMPTY_STATE: SessionState = { cookies: [], origins: [] };

/**
 * The login address and logged-in marker a page visit sends. A supplier that needs no login sends neither, and says its page
 * is public, so wording like "log in to see prices" is not taken as a login wall.
 */
export const loginFields = (supplier: Pick<SupplierRecord, "needsLogin" | "loginUrl" | "loggedInMarker">): { loginUrl?: string; loggedInMarker?: string; publicPage?: true } =>
  supplier.needsLogin ? { loginUrl: supplier.loginUrl ?? undefined, ...(supplier.loggedInMarker ? { loggedInMarker: supplier.loggedInMarker } : {}) } : { publicPage: true };

/**
 * A page that can be read without the browser: the supplier needs no login, no browser disguise or fresh browser was asked for
 * (a site that needs one refuses a plain, honestly named request), and the rules can be answered from built-in data alone.
 */
export const quickEligible = (supplier: Pick<SupplierRecord, "needsLogin" | "stealth" | "freshProfile">, recipe: Recipe): boolean =>
  !supplier.needsLogin && !supplier.stealth && !supplier.freshProfile && !!recipe.builtIn && recipe.pageChecks.length === 0 && !recipe.region;

/**
 * Whether a visit should start from an empty browser profile: the fresh browser switch is on and the supplier needs no login,
 * so there is no login to lose. Asked for on every page: a cookie the site flagged on one page never reaches the next.
 */
export const freshFor = (supplier: Pick<SupplierRecord, "needsLogin" | "freshProfile">): boolean => !supplier.needsLogin && supplier.freshProfile;
