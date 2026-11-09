import { describe, expect, it } from "vitest";
import { decideLinkStatus, isHomePage, isSupplierWide, isUnavailableCandidate, type LinkState, type Observation } from "./link-status.js";

const T0 = new Date("2026-11-10T08:00:00Z");
const hours = (n: number) => new Date(T0.getTime() + n * 3_600_000);
const URL_ = "https://acme.test/p/blue";
const HOME = "https://acme.test/";

const fresh: LinkState = { status: "not_checked", lastWorkedAt: null, workedTitle: null, workedHeading: null, missingChecks: 0, firstMissingAt: null, checkedAt: null };
const worked: LinkState = { ...fresh, status: "works", lastWorkedAt: T0, workedTitle: "Blue Widget", workedHeading: "Blue Widget", checkedAt: T0 };
const page = (over: Partial<Observation> = {}): Observation => ({ result: "ok", status: 200, finalUrl: URL_, title: "Blue Widget", heading: "Blue Widget", softNotFound: false, ...over });
const decide = (prev: LinkState, obs: Observation, now = hours(1), supplierWide = false) =>
  decideLinkStatus(prev, obs, { requestedUrl: URL_, homeUrl: HOME, now, supplierWide });

describe("decideLinkStatus: pages that loaded", () => {
  it("a normal page works and remembers its title and heading", () => {
    const s = decide(fresh, page());
    expect(s).toMatchObject({ status: "works", workedTitle: "Blue Widget", workedHeading: "Blue Widget", missingChecks: 0 });
    expect(s.lastWorkedAt).toEqual(hours(1));
  });

  it("a later normal page resets the missing count", () => {
    const missing = { ...worked, status: "page_missing" as const, missingChecks: 1, firstMissingAt: T0 };
    expect(decide(missing, page())).toMatchObject({ status: "works", missingChecks: 0, firstMissingAt: null });
  });

  it("a changed title says the page looks different, and keeps what it remembered", () => {
    const s = decide(worked, page({ title: "Red Gadget", heading: "Red Gadget" }));
    expect(s).toMatchObject({ status: "looks_different", workedTitle: "Blue Widget", missingChecks: 0 });
    expect(s.lastWorkedAt).toEqual(T0);
  });

  it("a redirect to a category is moved, not missing", () => {
    expect(decide(worked, page({ finalUrl: "https://acme.test/collections/widgets" }))).toMatchObject({ status: "moved", missingChecks: 0 });
  });

  it("a different query string is not a redirect", () => {
    expect(decide(worked, page({ finalUrl: `${URL_}?variant=9` })).status).toBe("works");
  });
});

describe("decideLinkStatus: pages that are gone", () => {
  it.each([[404], [410]])("a %i on a link that worked is page missing and counts once", (status) => {
    const s = decide(worked, page({ status, finalUrl: URL_ }));
    expect(s).toMatchObject({ status: "page_missing", missingChecks: 1 });
    expect(s.firstMissingAt).toEqual(hours(1));
    expect(s.lastWorkedAt).toEqual(T0);
  });

  it("a 'not found' page served with 200 counts as missing", () => {
    expect(decide(worked, page({ softNotFound: true })).status).toBe("page_missing");
  });

  it("a redirect to the home page on a link that worked is page missing", () => {
    expect(decide(worked, page({ finalUrl: HOME }))).toMatchObject({ status: "page_missing", missingChecks: 1 });
  });

  it("a wrong address that never worked is never worked, with no missing count", () => {
    expect(decide(fresh, page({ status: 404 }))).toMatchObject({ status: "never_worked", missingChecks: 0, firstMissingAt: null });
  });

  it("a redirect to the home page on a link that never worked is never worked", () => {
    expect(decide(fresh, page({ finalUrl: HOME }))).toMatchObject({ status: "never_worked", missingChecks: 0 });
  });

  it("keeps the first missing time on later missing checks", () => {
    const once = decide(worked, page({ status: 404 }), hours(1));
    const twice = decide(once, page({ status: 404 }), hours(8));
    expect(twice).toMatchObject({ missingChecks: 2 });
    expect(twice.firstMissingAt).toEqual(hours(1));
  });

  it("a supplier-wide run changes the status but not the missing count", () => {
    expect(decide(worked, page({ status: 404 }), hours(1), true)).toMatchObject({ status: "page_missing", missingChecks: 0, firstMissingAt: null });
  });

  it("a link that asks for the home page itself is not 'redirected home'", () => {
    const s = decideLinkStatus(fresh, page({ finalUrl: HOME }), { requestedUrl: HOME, homeUrl: HOME, now: hours(1), supplierWide: false });
    expect(s.status).toBe("works");
  });
});

describe("decideLinkStatus: checks that say nothing about the link", () => {
  const counted = { ...worked, status: "page_missing" as const, missingChecks: 1, firstMissingAt: T0 };
  it.each([["login_required"], ["captcha"], ["blocked"]] as const)("%s means needs login and leaves every count alone", (result) => {
    const s = decide(counted, page({ result, status: 403, finalUrl: null, title: null, heading: null }));
    expect(s).toMatchObject({ status: "needs_login", missingChecks: 1 });
    expect(s.firstMissingAt).toEqual(T0);
  });
  it.each([["unreachable"], ["unknown"], ["service_unavailable"]] as const)("%s means could not check and leaves every count alone", (result) => {
    expect(decide(counted, page({ result, status: null, finalUrl: null, title: null, heading: null }))).toMatchObject({ status: "could_not_check", missingChecks: 1 });
  });
  it("a 404 behind a login wall is never read as missing", () => {
    expect(decide(worked, page({ result: "login_required", status: 404 })).status).toBe("needs_login");
  });
});

describe("isUnavailableCandidate", () => {
  const missingTwice = (gapHours: number): LinkState => ({ ...worked, status: "page_missing", missingChecks: 2, firstMissingAt: T0, checkedAt: hours(gapHours) });
  it("needs two missing checks at least six hours apart", () => {
    expect(isUnavailableCandidate(missingTwice(6), false)).toBe(true);
    expect(isUnavailableCandidate(missingTwice(5.9), false)).toBe(false);
  });
  it("needs the link to have worked before", () => {
    expect(isUnavailableCandidate({ ...missingTwice(7), lastWorkedAt: null }, false)).toBe(false);
  });
  it("needs a single missing check to be followed by another", () => {
    expect(isUnavailableCandidate({ ...missingTwice(7), missingChecks: 1 }, false)).toBe(false);
  });
  it("is never true after a supplier-wide run", () => {
    expect(isUnavailableCandidate(missingTwice(7), true)).toBe(false);
  });
  it("is not true once the link works again", () => {
    expect(isUnavailableCandidate({ ...missingTwice(7), status: "works" }, false)).toBe(false);
  });
  it("is not true when the latest check could not tell", () => {
    expect(isUnavailableCandidate({ ...missingTwice(7), status: "needs_login" }, false)).toBe(false);
  });
});

describe("isSupplierWide", () => {
  const run = (missing: number, total: number) => [...Array(missing).fill("page_missing"), ...Array(total - missing).fill("works")];
  it("needs at least 5 links and at least 30% missing", () => {
    expect(isSupplierWide(run(2, 6))).toBe(true); // 33%
    expect(isSupplierWide(run(1, 5))).toBe(false); // 20%
    expect(isSupplierWide(run(4, 4))).toBe(false); // under 5 links
    expect(isSupplierWide(run(5, 5))).toBe(true);
  });
});

describe("isHomePage", () => {
  it("is the supplier's root, with or without www, query or trailing path slash", () => {
    expect(isHomePage("https://www.acme.test/", HOME)).toBe(true);
    expect(isHomePage("https://acme.test", HOME)).toBe(true);
    expect(isHomePage("https://acme.test/?ref=x", HOME)).toBe(true);
    expect(isHomePage("https://acme.test/p/blue", HOME)).toBe(false);
    expect(isHomePage("https://other.test/", HOME)).toBe(false);
  });
});
