import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { Writable } from "node:stream";
import { startTestDb, type TestDb } from "@stock-monitor/db/test-harness";
import { createCheckRunRepository, createMappingRepository, createNotificationRepository, createSupplierCredentialsRepository, createSupplierRepository, createSupplierSessionRepository } from "@stock-monitor/db";
import { createAuditWriter } from "@stock-monitor/audit";
import { createBrowserClient, type BrowserClient, type LoginCallOutcome, type LoginRequest } from "@stock-monitor/browser-client";
import { createFakeBrowserService, FAKE_CONTROL_TOKEN, type FakeBrowserService } from "@stock-monitor/browser-client/testing";
import { createLogger } from "@stock-monitor/shared";
import { sealCredentials, sealSessionState, unsealSessionState } from "@stock-monitor/supplier-session";
import { checkLink, checkSupplierLinks, type LinkCheckDeps } from "../src/mapping-link-check.js";

let t: TestDb;
let fake: FakeBrowserService;
const key = randomBytes(32);
const logLines: string[] = [];
const logger = createLogger({ level: "debug", stream: new Writable({ write: (c, _e, cb) => (logLines.push(c.toString()), cb()) }) });
const sleeps: number[] = [];
let onSleep: () => Promise<void> | void = () => {};

const COOKIE = "COOKIE-SECRET-MARKER-3a7c";
const state = { cookies: [{ name: "session", value: COOKIE, domain: "shop.acme.example", path: "/" }], origins: [] };
const T0 = new Date("2026-11-10T08:00:00Z");
let now = T0;

const suppliers = () => createSupplierRepository(t.appDb);
const maps = () => createMappingRepository(t.appDb);
const runs = () => createCheckRunRepository(t.appDb);
const deps = (over: Partial<LinkCheckDeps> = {}): LinkCheckDeps => ({
  mappings: maps(),
  suppliers: suppliers(),
  supplierSessions: createSupplierSessionRepository(t.appDb),
  supplierCredentials: createSupplierCredentialsRepository(t.appDb),
  notifications: createNotificationRepository(t.appDb),
  checkRuns: runs(),
  audit: createAuditWriter(t.appDb),
  browser: createBrowserClient({ baseUrl: fake.url, token: FAKE_CONTROL_TOKEN, timeoutMs: 2000 }),
  key,
  logger,
  sleep: async (ms) => {
    sleeps.push(ms);
    await onSleep();
  },
  now: () => now,
  ...over,
});

let acme = "";
const addVariant = (id: string) =>
  t.pool.query(
    `insert into shopify_variants (variant_id, product_id, product_title, variant_title, options, sku, inventory_item_id, tracked, inventory_policy)
     values ($1, 'p1', 'Tee', $2, '[]', $1, $3, true, 'DENY')`,
    [id, `Variant ${id}`, `inv-${id}`],
  );
const link = async (id: string, path = id) => {
  await addVariant(id);
  const r = await maps().create({ variantId: id, supplierId: acme, url: `https://shop.acme.example/p/${path}`, note: null });
  if (!r.ok) throw new Error("setup");
  return r.mapping.id;
};
const normal = { result: "ok", status: 200, title: "Blue Widget", heading: "Blue Widget", softNotFound: false };
const gone = { ...normal, status: 404, title: "Not found", heading: "Not found", softNotFound: true };
const checks = () => fake.requests.filter((r) => r.path === "/check-page");
const mapping = async (id: string) => (await maps().get(id))!;

beforeAll(async () => {
  t = await startTestDb();
  fake = await createFakeBrowserService();
}, 180_000);
afterAll(async () => {
  await fake?.close();
  await t?.stop();
});
beforeEach(async () => {
  await t.pool.query("truncate suppliers, shopify_variants, audit_events cascade");
  fake.requests.length = 0;
  logLines.length = 0;
  sleeps.length = 0;
  onSleep = () => {};
  now = T0;
  Object.assign(fake.behaviour, { checkPage: "ok", page: normal, pageFor: undefined, refreshed: undefined, delayMs: 0 });
  const a = await suppliers().create({ name: "Acme", websiteUrl: "https://shop.acme.example/", loginUrl: "https://shop.acme.example/login", checkIntervalMinutes: 60 });
  if (!a.ok) throw new Error("setup");
  acme = a.supplier.id;
  await createSupplierSessionRepository(t.appDb).save(acme, sealSessionState(state, key, "v1"), state);
  await suppliers().markConnected(acme);
  await suppliers().setPermission(acme, { status: "granted", note: null });
});

describe("a refreshed session", () => {
  it("is kept after a link check that found a logged-in page", async () => {
    const fresh = { cookies: [{ name: "session", value: "REFRESHED", domain: "shop.acme.example", path: "/" }], origins: [] };
    fake.behaviour.refreshed = fresh;
    await checkLink(deps(), await link("v1"));
    const stored = unsealSessionState((await createSupplierSessionRepository(t.appDb).getSealed(acme))!, key);
    expect(stored.cookies).toEqual(expect.arrayContaining(fresh.cookies));
  });
});

describe("one link", () => {
  it("opens the page with the saved session and records that it works", async () => {
    const id = await link("v1");
    expect(await checkLink(deps(), id)).toEqual({ kind: "checked", status: "works" });
    expect(checks()[0]?.body).toMatchObject({ url: "https://shop.acme.example/p/v1", loginUrl: "https://shop.acme.example/login", state });
    expect(await mapping(id)).toMatchObject({ linkStatus: "works", workedTitle: "Blue Widget", lastLinkCheckAt: T0 });
  });

  it("sends the supplier's logged-in marker with the check", async () => {
    await suppliers().setAutoLogin(acme, { loggedInMarker: "Log out" });
    await checkLink(deps(), await link("v1"));
    expect(checks()[0]?.body).toMatchObject({ loggedInMarker: "Log out" });
  });

  it("a page that is gone, on a link that worked, counts as missing once", async () => {
    const id = await link("v1");
    await checkLink(deps(), id);
    fake.behaviour.page = gone;
    now = new Date(T0.getTime() + 3_600_000);
    expect(await checkLink(deps(), id)).toEqual({ kind: "checked", status: "page_missing" });
    expect(await mapping(id)).toMatchObject({ linkStatus: "page_missing", missingChecks: 1 });
  });

  it("a wrong address that never worked is never worked, not missing", async () => {
    const id = await link("v1");
    fake.behaviour.page = gone;
    expect(await checkLink(deps(), id)).toEqual({ kind: "checked", status: "never_worked" });
    expect(await mapping(id)).toMatchObject({ missingChecks: 0 });
  });

  it("a page that shows a puzzle is never a broken link, and the supplier is marked as needing the owner", async () => {
    const id = await link("v1");
    await checkLink(deps(), id);
    fake.behaviour.page = { ...normal, result: "captcha", status: 403, finalUrl: null, title: null, heading: null };
    expect(await checkLink(deps(), id)).toEqual({ kind: "checked", status: "needs_login" });
    expect(await mapping(id)).toMatchObject({ linkStatus: "needs_login", missingChecks: 0 });
    expect(await suppliers().get(acme)).toMatchObject({ sessionStatus: "blocked", enabled: false, pausedReason: "session" });
    expect(await createNotificationRepository(t.appDb).listOpen()).toMatchObject([{ kind: "supplier_needs_reconnect", supplierId: acme, reason: "captcha" }]);
  });

  it("a login page marks the supplier as needing to reconnect, though the home page looked fine", async () => {
    const id = await link("v1");
    fake.behaviour.page = { ...normal, result: "login_required", status: 200, finalUrl: null, title: null, heading: null };
    expect(await checkLink(deps(), id)).toEqual({ kind: "checked", status: "needs_login" });
    expect(await suppliers().get(acme)).toMatchObject({ sessionStatus: "needs_reconnect" });
  });

  it("a browser service that does not answer means could not check", async () => {
    const id = await link("v1");
    fake.behaviour.checkPage = "fail";
    expect(await checkLink(deps(), id)).toEqual({ kind: "checked", status: "could_not_check" });
  });

  it.each([
    ["permission not recorded", async () => void (await suppliers().setPermission(acme, { status: "unknown", note: null })), "no_permission"],
    ["permission refused", async () => void (await suppliers().setPermission(acme, { status: "not_granted", note: null })), "no_permission"],
    ["supplier paused", async () => void (await suppliers().pause(acme)), "paused"],
    ["supplier not connected", async () => void (await createSupplierSessionRepository(t.appDb).remove(acme)), "not_connected"],
  ])("does not touch the supplier when %s", async (_name, change, reason) => {
    const id = await link("v1");
    await change();
    expect(await checkLink(deps(), id)).toEqual({ kind: "skipped", reason });
    expect(checks()).toHaveLength(0);
  });

  it("skips a link the owner switched off, and one that no longer exists", async () => {
    const id = await link("v1");
    await maps().update(id, { enabled: false });
    expect(await checkLink(deps(), id)).toEqual({ kind: "skipped", reason: "link_off" });
    expect(await checkLink(deps(), "00000000-0000-4000-8000-000000000000")).toEqual({ kind: "skipped", reason: "no_mapping" });
  });

  it("audits the result without the address, the session or any page content", async () => {
    const id = await link("v1");
    await checkLink(deps(), id);
    const rows = (await t.pool.query("select details from audit_events where action = 'mapping.link_checked'")).rows;
    expect(rows[0].details).toEqual({ status: "works" });
    const everything = JSON.stringify([rows, (await t.pool.query("select * from mappings")).rows, logLines]);
    expect(everything).not.toContain(COOKIE);
  });
});

describe("all of a supplier's links", () => {
  it("waits the supplier's pause between pages, not before the first or after the last", async () => {
    await suppliers().setPermission(acme, { status: "granted", note: null, pauseSeconds: 7 });
    await link("v1");
    await link("v2");
    await link("v3");
    expect(await checkSupplierLinks(deps(), acme)).toMatchObject({ kind: "done", checked: 3, supplierWide: false });
    expect(sleeps).toEqual([7000, 7000]);
    expect(checks()).toHaveLength(3);
  });

  it("calls a run where many links go missing at once a supplier-wide problem, and counts none of them", async () => {
    const ids: string[] = [];
    for (const n of ["a", "b", "c", "d", "e"]) ids.push(await link(n));
    for (const id of ids) await checkLink(deps(), id); // all worked
    fake.behaviour.page = gone;
    now = new Date(T0.getTime() + 8 * 3_600_000);
    expect(await checkSupplierLinks(deps(), acme)).toMatchObject({ kind: "done", checked: 5, supplierWide: true });
    for (const id of ids) expect(await mapping(id)).toMatchObject({ linkStatus: "page_missing", missingChecks: 0, firstMissingAt: null });
  });

  it("counts a few missing links normally", async () => {
    const ids: string[] = [];
    for (const n of ["a", "b", "c", "d", "e"]) ids.push(await link(n));
    for (const id of ids) await checkLink(deps(), id);
    fake.behaviour.pageFor = (url) => (url.endsWith("/a") ? gone : undefined);
    expect(await checkSupplierLinks(deps(), acme)).toMatchObject({ supplierWide: false });
    expect(await mapping(ids[0]!)).toMatchObject({ linkStatus: "page_missing", missingChecks: 1 });
    expect(await mapping(ids[1]!)).toMatchObject({ linkStatus: "works" });
  });

  it("stops when the supplier is paused while the run waits", async () => {
    await link("v1");
    await link("v2");
    onSleep = async () => void (await suppliers().pause(acme));
    expect(await checkSupplierLinks(deps(), acme)).toMatchObject({ kind: "done", checked: 1 });
    expect(checks()).toHaveLength(1);
  });

  it("is refused for a supplier that is not allowed, without touching it", async () => {
    await link("v1");
    await suppliers().setPermission(acme, { status: "unknown", note: null });
    expect(await checkSupplierLinks(deps(), acme)).toEqual({ kind: "skipped", reason: "no_permission" });
    expect(checks()).toHaveLength(0);
  });

  it("leaves out links the owner switched off", async () => {
    const id = await link("v1");
    await link("v2");
    await maps().update(id, { enabled: false });
    expect(await checkSupplierLinks(deps(), acme)).toMatchObject({ checked: 1 });
  });

  it("reports each page to its run record, then ends it finished", async () => {
    await link("v1");
    await link("v2");
    const run = (await runs().start(acme, "manual", 2, "links"))!;
    const done: number[] = [];
    onSleep = async () => void done.push((await runs().get(run.id))!.linksDone);
    expect(await checkSupplierLinks(deps(), acme, run.id)).toMatchObject({ kind: "done", checked: 2 });
    expect(done).toEqual([1]);
    expect(await runs().get(run.id)).toMatchObject({ outcome: "finished", linksDone: 2, stopReason: null });
  });

  it("ends its run stopped when the supplier is paused while it waits, and does nothing for a run already ended", async () => {
    await link("v1");
    await link("v2");
    const run = (await runs().start(acme, "manual", 2, "links"))!;
    onSleep = async () => void (await suppliers().pause(acme));
    await checkSupplierLinks(deps(), acme, run.id);
    expect(await runs().get(run.id)).toMatchObject({ outcome: "stopped", stopReason: "supplier_not_ready", linksDone: 1 });
    await suppliers().resume(acme);
    expect(await checkSupplierLinks(deps(), acme, run.id)).toEqual({ kind: "skipped", reason: "run_ended" });
  });

  it("does nothing for a supplier that was deleted while the job waited", async () => {
    expect(await checkSupplierLinks(deps(), "00000000-0000-4000-8000-000000000000")).toEqual({ kind: "skipped", reason: "no_supplier" });
  });
});

describe("automatic login in a link run", () => {
  const NEW = { cookies: [{ name: "session", value: "NEW-LOGIN", domain: "shop.acme.example", path: "/" }], origins: [] };
  const logins: { checkUrl: string; pagesBefore: number }[] = [];
  const withLogin = (): BrowserClient => ({
    ...createBrowserClient({ baseUrl: fake.url, token: FAKE_CONTROL_TOKEN, timeoutMs: 2000 }),
    async login(r: LoginRequest): Promise<LoginCallOutcome> {
      logins.push({ checkUrl: r.checkUrl, pagesBefore: checks().length });
      return { ok: true, outcome: { result: "ok", state: NEW } };
    },
  });
  const autoLogin = async (lastVerifiedMinutesAgo: number) => {
    await createSupplierCredentialsRepository(t.appDb).save(acme, sealCredentials({ username: "u", password: "p" }, key, "v1"));
    const on = await suppliers().setAutoLogin(acme, { autoLogin: true });
    if (!on.ok) throw new Error("setup");
    await t.pool.query("update supplier_sessions set last_verified_at = $2 where supplier_id = $1", [acme, new Date(T0.getTime() - lastVerifiedMinutesAgo * 60_000)]);
  };
  beforeEach(() => {
    logins.length = 0;
  });

  it("logs in once before the first page when the session is stale", async () => {
    await link("v1");
    await link("v2");
    await autoLogin(60);
    expect(await checkSupplierLinks(deps({ browser: withLogin() }), acme)).toMatchObject({ kind: "done", checked: 2 });
    expect(logins).toEqual([{ checkUrl: "https://shop.acme.example/p/v1", pagesBefore: 0 }]);
    expect((checks()[0]?.body as { state: { cookies: { value: string }[] } }).state.cookies.map((c) => c.value)).toContain("NEW-LOGIN");
  });

  it("logs in again when a page asks for a login, and retries that page once", async () => {
    await link("v1");
    await link("v2");
    await autoLogin(5);
    let asked = 0;
    fake.behaviour.pageFor = (url) => (url.endsWith("/v2") && asked++ === 0 ? { ...normal, result: "login_required" } : undefined);
    expect(await checkSupplierLinks(deps({ browser: withLogin() }), acme)).toMatchObject({ kind: "done", checked: 2 });
    expect(logins).toHaveLength(1);
    expect(checks().map((r) => (r.body as { url: string }).url.split("/").pop())).toEqual(["v1", "v2", "v2"]);
    expect(await createNotificationRepository(t.appDb).listOpen()).toEqual([]);
  });
  it("does not log in a second time right after logging in at the start: the first page still asking for a login is reported", async () => {
    await link("v1");
    await link("v2");
    await autoLogin(60);
    fake.behaviour.pageFor = (url) => (url.endsWith("/v1") ? { ...normal, result: "login_required" } : undefined);
    // A link run goes on to the other links and then tells the owner, as it does for any login page.
    expect(await checkSupplierLinks(deps({ browser: withLogin() }), acme)).toMatchObject({ kind: "done", checked: 2 });
    // The supplier just accepted a login, so a second one seconds later would only repeat it.
    expect(logins).toHaveLength(1);
    expect(checks().map((r) => (r.body as { url: string }).url.split("/").pop())).toEqual(["v1", "v2"]);
    expect((await createNotificationRepository(t.appDb).listOpen()).map((n) => n.reason)).toEqual(["login_required"]);
  });

  it("asks for the stealth browser on every link of a stealth supplier, and only then", async () => {
    await link("v1");
    await link("v2");
    expect(await checkSupplierLinks(deps(), acme)).toMatchObject({ kind: "done", checked: 2 });
    expect(checks().map((r) => (r.body as { stealth?: boolean }).stealth)).toEqual([undefined, undefined]);
    fake.requests.length = 0;
    const on = await suppliers().setAutoLogin(acme, { stealth: true });
    if (!on.ok) throw new Error("setup");
    expect(await checkSupplierLinks(deps(), acme)).toMatchObject({ kind: "done", checked: 2 });
    expect(checks().map((r) => (r.body as { stealth?: boolean }).stealth)).toEqual([true, true]);
  });

  it("still logs in again when the session dies later in a link run that began with a login", async () => {
    await link("v1");
    await link("v2");
    await link("v3");
    await autoLogin(60);
    let asked = 0;
    fake.behaviour.pageFor = (url) => (url.endsWith("/v3") && asked++ === 0 ? { ...normal, result: "login_required" } : undefined);
    expect(await checkSupplierLinks(deps({ browser: withLogin() }), acme)).toMatchObject({ kind: "done", checked: 3 });
    expect(logins).toHaveLength(2);
    expect(checks().map((r) => (r.body as { url: string }).url.split("/").pop())).toEqual(["v1", "v2", "v3", "v3"]);
    expect(await createNotificationRepository(t.appDb).listOpen()).toEqual([]);
  });

  it("one link does not log in a second time right after logging in first", async () => {
    const id = await link("v1");
    await autoLogin(60);
    fake.behaviour.pageFor = () => ({ ...normal, result: "login_required" });
    expect(await checkLink(deps({ browser: withLogin() }), id)).toMatchObject({ kind: "checked" });
    expect(logins).toHaveLength(1);
    expect(checks()).toHaveLength(1);
    expect((await createNotificationRepository(t.appDb).listOpen()).map((n) => n.reason)).toEqual(["login_required"]);
  });

  it("the 1 h case: one link meeting a login page logs in, retries it, and the supplier stays ready", async () => {
    const id = await link("v1");
    await autoLogin(5);
    let asked = 0;
    fake.behaviour.pageFor = () => (asked++ === 0 ? { ...normal, result: "login_required" } : undefined);
    expect(await checkLink(deps({ browser: withLogin() }), id)).toEqual({ kind: "checked", status: "works" });
    expect(logins).toEqual([{ checkUrl: "https://shop.acme.example/p/v1", pagesBefore: 1 }]);
    expect(checks()).toHaveLength(2);
    expect((await suppliers().get(acme))?.sessionStatus).toBe("connected");
    expect(await createNotificationRepository(t.appDb).listOpen()).toEqual([]);
    expect(await checkSupplierLinks(deps({ browser: withLogin() }), acme)).toMatchObject({ kind: "done", checked: 1 });
  });

  it("one link logs in first when the session is stale, on that link's address", async () => {
    const id = await link("v1", "deep/v1");
    await autoLogin(60);
    expect(await checkLink(deps({ browser: withLogin() }), id)).toEqual({ kind: "checked", status: "works" });
    expect(logins).toEqual([{ checkUrl: "https://shop.acme.example/p/deep/v1", pagesBefore: 0 }]);
  });

  it("one link stops when the login fails, keeping the login's own notice", async () => {
    const id = await link("v1");
    await autoLogin(60);
    const refused = { ...withLogin(), login: async (): Promise<LoginCallOutcome> => ({ ok: true, outcome: { result: "captcha" } as never }) };
    expect(await checkLink(deps({ browser: refused }), id)).toMatchObject({ kind: "checked" });
    expect(checks()).toHaveLength(0);
    expect((await createNotificationRepository(t.appDb).listOpen()).map((n) => n.reason)).toEqual(["captcha"]);
  });
});

describe("a supplier that needs no login", () => {
  it("checks its links with no session and no login address", async () => {
    await createSupplierSessionRepository(t.appDb).remove(acme);
    await suppliers().markNotConnected(acme);
    await suppliers().setNeedsLogin(acme, false);
    const id = await link("v1");
    expect(await checkLink(deps(), id)).toEqual({ kind: "checked", status: "works" });
    const body = checks()[0]?.body as Record<string, unknown>;
    expect(body.state).toEqual({ cookies: [], origins: [] });
    expect(body.loginUrl).toBeUndefined();
    expect(await createSupplierSessionRepository(t.appDb).getSealed(acme)).toBeNull();
  });

  it("asks a fresh-browser supplier for a fresh profile on the first link of a run, and on a single link check", async () => {
    await createSupplierSessionRepository(t.appDb).remove(acme);
    await suppliers().markNotConnected(acme);
    await suppliers().setNeedsLogin(acme, false);
    await suppliers().setAutoLogin(acme, { freshProfile: true });
    const id = await link("v1");
    await link("v2");
    expect(await checkSupplierLinks(deps(), acme)).toMatchObject({ kind: "done", checked: 2 });
    expect(checks().map((r) => (r.body as { freshProfile?: boolean }).freshProfile)).toEqual([true, undefined]);
    fake.requests.length = 0;
    await checkLink(deps(), id);
    expect((checks()[0]?.body as { freshProfile?: boolean }).freshProfile).toBe(true);
  });
});
