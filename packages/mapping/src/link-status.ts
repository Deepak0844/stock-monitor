import type { PageClass } from "@stock-monitor/supplier-session";

export const LINK_STATUSES = ["not_checked", "works", "never_worked", "page_missing", "moved", "looks_different", "needs_login", "could_not_check"] as const;
export type LinkStatus = (typeof LINK_STATUSES)[number];

/** What one link check saw. Only the page's address, title and first heading: never stock, prices or page text. */
export type Observation = {
  result: PageClass | "service_unavailable";
  status: number | null;
  finalUrl: string | null;
  title: string | null;
  heading: string | null;
  /** A "not found" page the supplier served with a normal status. */
  softNotFound: boolean;
};

/** Everything kept about a link between checks. `checkedAt` is the time of the latest check. */
export type LinkState = {
  status: LinkStatus;
  lastWorkedAt: Date | null;
  workedTitle: string | null;
  workedHeading: string | null;
  missingChecks: number;
  firstMissingAt: Date | null;
  checkedAt: Date | null;
};

export type DecideContext = { requestedUrl: string; homeUrl: string; now: Date; supplierWide: boolean };

const MIN_MISSING_CHECKS = 2;
const MIN_GAP_MS = 6 * 3_600_000;
const SUPPLIER_WIDE_MIN_LINKS = 5;
const SUPPLIER_WIDE_SHARE = 0.3;

const bare = (host: string) => host.toLowerCase().replace(/^www\./, "");
const parse = (url: string) => {
  try {
    return new URL(url);
  } catch {
    return null;
  }
};
const trimSlash = (path: string) => (path.length > 1 ? path.replace(/\/+$/, "") : path) || "/";
const norm = (text: string | null) => (text ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/** The supplier's root page, with or without www, a query string or a trailing slash. */
export function isHomePage(finalUrl: string, homeUrl: string): boolean {
  const page = parse(finalUrl);
  const home = parse(homeUrl);
  return !!page && !!home && bare(page.hostname) === bare(home.hostname) && trimSlash(page.pathname) === "/";
}

const samePage = (a: string, b: string) => {
  const [x, y] = [parse(a), parse(b)];
  return !!x && !!y && bare(x.hostname) === bare(y.hostname) && trimSlash(x.pathname).toLowerCase() === trimSlash(y.pathname).toLowerCase();
};

/**
 * Works out a link's new state from one check. It only ever says what happened to the LINK, never anything
 * about stock. A check that asked for a login, hit a puzzle or a block, or could not run, changes only the
 * status: it never counts towards "page missing".
 */
export function decideLinkStatus(prev: LinkState, obs: Observation, ctx: DecideContext): LinkState {
  const next = (status: LinkStatus, over: Partial<LinkState> = {}): LinkState => ({ ...prev, status, checkedAt: ctx.now, ...over });

  if (obs.result === "login_required" || obs.result === "captcha" || obs.result === "blocked") return next("needs_login");
  if (obs.result !== "ok" && obs.result !== "unknown") return next("could_not_check");

  const gone =
    obs.status === 404 || obs.status === 410 || obs.softNotFound ||
    (obs.finalUrl !== null && !isHomePage(ctx.requestedUrl, ctx.homeUrl) && isHomePage(obs.finalUrl, ctx.homeUrl));
  if (gone) {
    if (!prev.lastWorkedAt) return next("never_worked");
    if (ctx.supplierWide) return next("page_missing");
    return next("page_missing", { missingChecks: prev.missingChecks + 1, firstMissingAt: prev.firstMissingAt ?? ctx.now });
  }
  if (obs.result === "unknown") return next("could_not_check");
  if (obs.finalUrl !== null && !samePage(obs.finalUrl, ctx.requestedUrl)) return next("moved");

  const titleChanged = !!prev.workedTitle && !!obs.title && norm(prev.workedTitle) !== norm(obs.title);
  const headingChanged = !!prev.workedHeading && !!obs.heading && norm(prev.workedHeading) !== norm(obs.heading);
  if (prev.lastWorkedAt && (titleChanged || headingChanged)) return next("looks_different");

  return next("works", {
    lastWorkedAt: ctx.now,
    workedTitle: prev.workedTitle ?? obs.title,
    workedHeading: prev.workedHeading ?? obs.heading,
    missingChecks: 0,
    firstMissingAt: null,
  });
}

/** True when a whole run looks like a site change or outage: at least 5 links and at least 30% page missing. */
export function isSupplierWide(statuses: readonly LinkStatus[]): boolean {
  const missing = statuses.filter((s) => s === "page_missing").length;
  return statuses.length >= SUPPLIER_WIDE_MIN_LINKS && missing / statuses.length >= SUPPLIER_WIDE_SHARE;
}

/**
 * The link worked before and its page is missing on two checks at least 6 hours apart, and the latest run was not
 * supplier-wide. `proposals` may suggest "unavailable" for the owner to approve. Mapping never decides stock.
 */
export function isUnavailableCandidate(state: LinkState, supplierWide: boolean): boolean {
  if (supplierWide || state.status !== "page_missing" || !state.lastWorkedAt || !state.firstMissingAt || !state.checkedAt) return false;
  return state.missingChecks >= MIN_MISSING_CHECKS && state.checkedAt.getTime() - state.firstMissingAt.getTime() >= MIN_GAP_MS;
}
