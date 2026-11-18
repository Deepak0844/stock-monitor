import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { Writable } from "node:stream";
import { startTestDb, type TestDb } from "@stock-monitor/db/test-harness";
import { createCheckRunRepository, createMappingRepository, createNotificationRepository, createRecipeRepository, createSupplierCredentialsRepository, createSupplierRepository, createSupplierSessionRepository } from "@stock-monitor/db";
import { createAuditWriter } from "@stock-monitor/audit";
import type { BrowserClient, LoginCallOutcome, LoginRequest } from "@stock-monitor/browser-client";
import { createLogger } from "@stock-monitor/shared";
import { sealCredentials, sealSessionState, unsealSessionState, type SessionState } from "@stock-monitor/supplier-session";
import { AUTO_LOGIN_FRESH_MINUTES, createAutoLoginTestHandler, ensureLoggedIn, type AutoLoginDeps, type AutoLoginTestDeps } from "../src/auto-login.js";
import { stockGate } from "../src/extraction-check.js";
import type { Mail, MailSource } from "../src/code-reader.js";

let t: TestDb;
const key = randomBytes(32);
const logLines: string[] = [];
const logger = createLogger({ level: "debug", stream: new Writable({ write: (c, _e, cb) => (logLines.push(c.toString()), cb()) }) });

const USERNAME = "USERNAME-SECRET-MARKER-41f0";
const PASSWORD = "PASSWORD-SECRET-MARKER-7d2b";
const session = (value: string): SessionState => ({ cookies: [{ name: "sid", value, domain: "shop.acme.example", path: "/", expires: -1 }], origins: [] });
const OLD = session("OLD-COOKIE");
const NEW = session("NEW-COOKIE");

const suppliers = () => createSupplierRepository(t.appDb);
const sessions = () => createSupplierSessionRepository(t.appDb);
const credentials = () => createSupplierCredentialsRepository(t.appDb);

/** A fake browser: only `login` is used. Each call returns the next queued reply. */
let replies: (LoginCallOutcome | (() => Promise<LoginCallOutcome>))[] = [];
const calls: LoginRequest[] = [];
const codeCalls: { holdId: string; code?: string; cancelled?: true }[] = [];
const browser = {
  async login(r: LoginRequest): Promise<LoginCallOutcome> {
    calls.push(r);
    const next = replies.shift() ?? { ok: true, outcome: { result: "ok", state: NEW } };
    return typeof next === "function" ? next() : next;
  },
  async sendCode(holdId: string, code: string): Promise<LoginCallOutcome> {
    codeCalls.push({ holdId, code });
    return code === "482913" ? { ok: true, outcome: { result: "ok", state: NEW } } : { ok: true, outcome: { result: "code_required" } };
  },
  async cancelCode(holdId: string): Promise<void> {
    codeCalls.push({ holdId, cancelled: true });
  },
} as unknown as BrowserClient;

const deps = (over: Partial<AutoLoginDeps> = {}): AutoLoginDeps => ({
  suppliers: suppliers(),
  supplierSessions: sessions(),
  supplierCredentials: credentials(),
  notifications: createNotificationRepository(t.appDb),
  audit: createAuditWriter(t.appDb),
  browser,
  key,
  logger,
  ...over,
});
const opts = { force: true, checkUrl: "https://shop.acme.example/account" };

let id = "";
beforeAll(async () => {
  t = await startTestDb();
}, 180_000);
afterAll(async () => {
  await t?.stop();
});
beforeEach(async () => {
  await t.pool.query("truncate suppliers, shopify_variants, audit_events cascade");
  logLines.length = 0;
  calls.length = 0;
  codeCalls.length = 0;
  replies = [];
  const s = await suppliers().create({ name: "Acme", websiteUrl: "https://shop.acme.example/", loginUrl: "https://shop.acme.example/login", checkIntervalMinutes: 60 });
  if (!s.ok) throw new Error("setup");
  id = s.supplier.id;
  await suppliers().setPermission(id, { status: "granted", note: null });
  await credentials().save(id, sealCredentials({ username: USERNAME, password: PASSWORD }, key, "v1"));
  const on = await suppliers().setAutoLogin(id, { autoLogin: true });
  if (!on.ok) throw new Error("setup");
  await sessions().save(id, sealSessionState(OLD, key, "v1"), OLD);
});

const supplier = async () => (await suppliers().get(id))!;
const stored = async () => unsealSessionState((await sessions().getSealed(id))!, key);
const notice = async () => (await t.pool.query("select reason, message from notifications where supplier_id = $1 and resolved_at is null", [id])).rows[0] as { reason: string; message: string } | undefined;
const audits = async () => (await t.pool.query("select details from audit_events where action = 'supplier.auto_login' order by id")).rows as { details: unknown }[];
const reply = (result: string, state?: SessionState): LoginCallOutcome => ({ ok: true, outcome: { result, ...(state ? { state } : {}) } as never });

describe("when automatic login does not run", () => {
  it("skips when off", async () => {
    await suppliers().setAutoLogin(id, { autoLogin: false });
    expect(await ensureLoggedIn(deps(), await supplier(), opts)).toBe("skipped");
    expect(calls).toHaveLength(0);
  });

  it("skips when paused", async () => {
    await t.pool.query("update suppliers set auto_login_paused_reason = 'too_many_failures' where id = $1", [id]);
    expect(await ensureLoggedIn(deps(), await supplier(), opts)).toBe("skipped");
    expect(calls).toHaveLength(0);
  });

  it("skips, with a warning, when no credentials are saved", async () => {
    await credentials().remove(id);
    expect(await ensureLoggedIn(deps(), await supplier(), opts)).toBe("skipped");
    expect(calls).toHaveLength(0);
    expect(await notice()).toBeUndefined();
    expect(logLines.join("")).toContain("no saved credentials");
  });
});

describe("fresh session", () => {
  it(`is ready without a login when checked less than ${AUTO_LOGIN_FRESH_MINUTES} minutes ago`, async () => {
    await t.pool.query("update supplier_sessions set last_verified_at = now() - interval '5 minutes' where supplier_id = $1", [id]);
    expect(await ensureLoggedIn(deps(), await supplier(), { ...opts, force: false })).toBe("ready");
    expect(calls).toHaveLength(0);
  });

  it("logs in when the last check is older", async () => {
    await t.pool.query("update supplier_sessions set last_verified_at = now() - interval '11 minutes' where supplier_id = $1", [id]);
    expect(await ensureLoggedIn(deps(), await supplier(), { ...opts, force: false })).toBe("ready");
    expect(calls).toHaveLength(1);
  });

  it("logs in when forced, however fresh", async () => {
    await sessions().markVerified(id);
    expect(await ensureLoggedIn(deps(), await supplier(), opts)).toBe("ready");
    expect(calls).toHaveLength(1);
  });
});

describe("the login request", () => {
  it("sends the login page, the check page, the saved login and the stealth setting", async () => {
    await ensureLoggedIn(deps(), await supplier(), opts);
    expect(calls[0]).toEqual({ loginUrl: "https://shop.acme.example/login", checkUrl: opts.checkUrl, username: USERNAME, password: PASSWORD, stealth: false });
  });

  it("falls back to the website, and passes the account and selectors when there are some", async () => {
    await t.pool.query("update suppliers set login_url = null where id = $1", [id]);
    await credentials().save(id, sealCredentials({ username: USERNAME, password: PASSWORD, account: "ACC-1" }, key, "v1"));
    await suppliers().setAutoLogin(id, { loginSelectors: { submit: "#go" } });
    await ensureLoggedIn(deps(), await supplier(), opts);
    expect(calls[0]).toMatchObject({ loginUrl: "https://shop.acme.example/", account: "ACC-1", selectors: { submit: "#go" } });
  });

  it("passes the logged-in marker when there is one, and leaves it out when there is not", async () => {
    await ensureLoggedIn(deps(), await supplier(), opts);
    expect("loggedInMarker" in calls[0]!).toBe(false);
    await suppliers().setAutoLogin(id, { loggedInMarker: "Log out" });
    await ensureLoggedIn(deps(), await supplier(), opts);
    expect(calls.at(-1)).toMatchObject({ loggedInMarker: "Log out" });
  });
});

describe("results", () => {
  it("ok: replaces the session, marks it checked, resets the count, clears the notice", async () => {
    await t.pool.query("update suppliers set auto_login_failures = 1 where id = $1", [id]);
    await createNotificationRepository(t.appDb).raise({ kind: "supplier_needs_reconnect", supplierId: id, message: "x", reason: "login_required" });
    replies = [reply("ok", NEW)];
    expect(await ensureLoggedIn(deps(), await supplier(), opts)).toBe("ready");
    expect(await stored()).toEqual(NEW);
    expect((await sessions().facts(id))?.lastVerifiedAt).toBeInstanceOf(Date);
    const s = await supplier();
    expect(s.autoLoginFailures).toBe(0);
    expect(s.lastAutoLoginResult).toBe("ok");
    expect(s.lastAutoLoginAt).toBeInstanceOf(Date);
    expect(s.sessionStatus).toBe("connected");
    expect(await notice()).toBeUndefined();
  });

  it("ok with no session saved before: saves a new one", async () => {
    await sessions().remove(id);
    replies = [reply("ok", NEW)];
    expect(await ensureLoggedIn(deps(), await supplier(), opts)).toBe("ready");
    expect(await stored()).toEqual(NEW);
    expect((await sessions().facts(id))?.lastVerifiedAt).toBeInstanceOf(Date);
  });

  it("ok with no session sent back: treated as unknown", async () => {
    replies = [reply("ok")];
    expect(await ensureLoggedIn(deps(), await supplier(), opts)).toBe("login_required");
    expect((await supplier()).lastAutoLoginResult).toBe("unknown");
    expect(await stored()).toEqual(OLD);
  });

  const rows: [string, string, number, string | null, string][] = [
    ["captcha", "captcha", 1, null, "captcha"],
    ["code_required", "login_required", 1, null, "code_required"],
    ["blocked", "blocked", 1, null, "blocked"],
    ["form_not_found", "login_required", 1, null, "form_not_found"],
    ["unknown", "login_required", 1, null, "login_required"],
    ["wrong_password", "login_required", 1, "wrong_password", "wrong_password"],
    ["account_locked", "blocked", 1, "account_locked", "account_locked"],
  ];
  it.each(rows)("%s: returns %s, count %i, pause %s, notice %s", async (result, returns, failures, paused, reason) => {
    replies = [reply(result)];
    expect(await ensureLoggedIn(deps(), await supplier(), opts)).toBe(returns);
    const s = await supplier();
    expect(s.autoLoginFailures).toBe(failures);
    expect(s.autoLoginPausedReason).toBe(paused);
    expect(s.lastAutoLoginResult).toBe(result);
    expect((await notice())?.reason).toBe(reason);
    expect(await stored()).toEqual(OLD);
  });

  it.each([
    ["code_required", "The supplier asked for a code. Log in in the live window and type it there."],
    ["wrong_password", "The supplier refused the saved password. Automatic login is paused until you save it again."],
    ["account_locked", "The supplier says the account is locked. Automatic login is paused. Unlock it on the supplier's site, then press Resume."],
    ["form_not_found", "Automatic login could not find the login form. Set the login page fields on the supplier page."],
  ])("%s: uses the exact words", async (result, message) => {
    replies = [reply(result)];
    await ensureLoggedIn(deps(), await supplier(), opts);
    expect((await notice())?.message).toBe(message);
  });

  it("unreachable: returns unreachable, count unchanged, no notice", async () => {
    replies = [reply("unreachable")];
    expect(await ensureLoggedIn(deps(), await supplier(), opts)).toBe("unreachable");
    const s = await supplier();
    expect(s.autoLoginFailures).toBe(0);
    expect(s.autoLoginPausedReason).toBeNull();
    expect(s.lastAutoLoginResult).toBe("unreachable");
    expect(await notice()).toBeUndefined();
  });

  it.each(["unavailable", "failed"] as const)("the browser service %s: treated as unreachable", async (reason) => {
    replies = [{ ok: false, reason }];
    expect(await ensureLoggedIn(deps(), await supplier(), opts)).toBe("unreachable");
    expect((await supplier()).autoLoginFailures).toBe(0);
    expect(await notice()).toBeUndefined();
    expect(logLines.join("")).toContain(reason);
  });

  it("the browser service has no login (not in profile mode): skipped, nothing recorded, one warning", async () => {
    replies = [{ ok: false, reason: "not_supported" }];
    expect(await ensureLoggedIn(deps(), await supplier(), opts)).toBe("skipped");
    const s = await supplier();
    expect(s.autoLoginFailures).toBe(0);
    expect(s.lastAutoLoginResult).toBeNull();
    expect(s.lastAutoLoginAt).toBeNull();
    expect(await audits()).toHaveLength(0);
    expect(await notice()).toBeUndefined();
    const warnings = logLines.filter((l) => l.includes('"not_supported"'));
    expect(warnings).toHaveLength(1);
    expect(JSON.parse(warnings[0]!)).toMatchObject({ supplierId: id, reason: "not_supported" });
  });

  it("a thrown error: logs its name only, returns unreachable, count unchanged", async () => {
    replies = [async () => Promise.reject(new TypeError(`boom ${PASSWORD}`))];
    expect(await ensureLoggedIn(deps(), await supplier(), opts)).toBe("unreachable");
    expect((await supplier()).autoLoginFailures).toBe(0);
    expect(logLines.join("")).toContain("TypeError");
    expect(logLines.join("")).not.toContain(PASSWORD);
  });
});

describe("two failures pause", () => {
  it("pauses after two captchas in a row, and a third call is skipped", async () => {
    replies = [reply("captcha"), reply("captcha")];
    expect(await ensureLoggedIn(deps(), await supplier(), opts)).toBe("captcha");
    expect((await supplier()).autoLoginPausedReason).toBeNull();
    expect(await ensureLoggedIn(deps(), await supplier(), opts)).toBe("captcha");
    expect((await supplier()).autoLoginPausedReason).toBe("too_many_failures");
    expect(await ensureLoggedIn(deps(), await supplier(), opts)).toBe("skipped");
    expect(calls).toHaveLength(2);
  });
});

describe("owner wins", () => {
  it("keeps the owner's live-window login made while the automatic one ran", async () => {
    const OWNER = session("OWNER-COOKIE");
    replies = [
      async () => {
        await sessions().save(id, sealSessionState(OWNER, key, "v1"), OWNER);
        return reply("ok", NEW);
      },
    ];
    expect(await ensureLoggedIn(deps(), await supplier(), opts)).toBe("ready");
    expect(await stored()).toEqual(OWNER);
  });
});

describe("owner wins with no session before", () => {
  it("keeps the owner's live-window login when there was no session when the automatic one started", async () => {
    await sessions().remove(id);
    const OWNER = session("OWNER-COOKIE");
    replies = [
      async () => {
        await sessions().save(id, sealSessionState(OWNER, key, "v1"), OWNER);
        return reply("ok", NEW);
      },
    ];
    expect(await ensureLoggedIn(deps(), await supplier(), opts)).toBe("ready");
    expect(await stored()).toEqual(OWNER);
  });
});

describe("the owner's fix lifts the pause", () => {
  it("after a wrong password, saving the password again lets stock checks run", async () => {
    await suppliers().markConnected(id);
    const recipes = createRecipeRepository(t.appDb);
    const rules = { pageChecks: [{ type: "text", text: "Blue Tee" }], inStock: [{ type: "button", label: "Add to cart", enabled: true }], outOfStock: [{ type: "text", text: "Sold out" }] };
    await recipes.activate((await recipes.create(id, rules)).id);
    const gate = () => stockGate({ suppliers: suppliers(), supplierSessions: sessions(), recipes }, id);
    replies = [reply("wrong_password")];
    await ensureLoggedIn(deps(), await supplier(), opts);
    expect(await gate()).toEqual({ reason: "needs_attention" });
    await credentials().save(id, sealCredentials({ username: USERNAME, password: PASSWORD }, key, "v1"));
    expect(await gate()).toHaveProperty("supplier");
  });
});

describe("no secrets", () => {
  it("keeps the username and password out of audit rows, logs and notices", async () => {
    replies = [reply("ok", NEW), reply("captcha"), reply("wrong_password"), { ok: false, reason: "failed" }];
    for (let i = 0; i < 4; i++) {
      await t.pool.query("update suppliers set auto_login_paused_reason = null, auto_login_failures = 0 where id = $1", [id]);
      await ensureLoggedIn(deps(), await supplier(), opts);
    }
    const rows = await audits();
    expect(rows).toHaveLength(4);
    expect(rows[0]?.details).toEqual({ result: "ok", stealth: false });
    const all = JSON.stringify(rows) + logLines.join("") + JSON.stringify((await t.pool.query("select * from notifications")).rows);
    expect(all).not.toContain(USERNAME);
    expect(all).not.toContain(PASSWORD);
  });
});

describe("the test login job", () => {
  // 2026-06-10 10:00 UTC.
  const NOON = new Date(Date.UTC(2026, 5, 10, 10, 0));
  const testDeps = (over: Partial<AutoLoginTestDeps> = {}): AutoLoginTestDeps => ({
    ...deps(),
    checkRuns: createCheckRunRepository(t.appDb),
    mappings: createMappingRepository(t.appDb),
    timezone: "UTC",
    now: () => NOON,
    ...over,
  });
  const test = (over: Partial<AutoLoginTestDeps> = {}) => createAutoLoginTestHandler(testDeps(over))({ supplierId: id });
  const addLink = async (v: string, enabled = true) => {
    await t.pool.query(
      `insert into shopify_variants (variant_id, product_id, product_title, variant_title, options, sku, inventory_item_id, tracked, inventory_policy)
       values ($1, 'p1', 'Tee', $1, '[]', $1, $1, true, 'DENY')`,
      [v],
    );
    const r = await createMappingRepository(t.appDb).create({ variantId: v, supplierId: id, url: `https://shop.acme.example/p/${v}`, note: null });
    if (!r.ok) throw new Error("setup");
    if (!enabled) await createMappingRepository(t.appDb).update(r.mapping.id, { enabled: false });
  };

  it("logs in, forced, checking the first enabled link", async () => {
    await sessions().markVerified(id);
    await addLink("off", false);
    await addLink("on");
    expect(await test()).toEqual({ kind: "done", result: "ready" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ checkUrl: "https://shop.acme.example/p/on" });
  });

  it("checks the website when the supplier has no enabled link", async () => {
    expect(await test()).toEqual({ kind: "done", result: "ready" });
    expect(calls[0]).toMatchObject({ checkUrl: "https://shop.acme.example/" });
  });

  it("is refused in quiet hours", async () => {
    await suppliers().setSchedule(id, { intervalMinutes: 1440, window: { start: "11:00", end: "22:00" }, nextCheckAt: null });
    expect(await test()).toEqual({ kind: "skipped", reason: "quiet_hours" });
    expect(calls).toHaveLength(0);
  });

  it("runs inside the supplier's hours", async () => {
    await suppliers().setSchedule(id, { intervalMinutes: 1440, window: { start: "07:00", end: "22:00" }, nextCheckAt: null });
    expect(await test()).toEqual({ kind: "done", result: "ready" });
  });

  it("is refused while the supplier has a run going", async () => {
    await createCheckRunRepository(t.appDb).start(id, "manual", 0);
    expect(await test()).toEqual({ kind: "skipped", reason: "run_going" });
    expect(calls).toHaveLength(0);
  });

  it("is refused, with a warning and no notice, when the supplier is not allowed", async () => {
    await suppliers().setPermission(id, { status: "unknown", note: null });
    expect(await test()).toEqual({ kind: "skipped", reason: "no_permission" });
    expect(calls).toHaveLength(0);
    expect(await notice()).toBeUndefined();
    expect(logLines.join("")).toContain("no_permission");
  });

  it("is refused when no credentials are saved", async () => {
    await credentials().remove(id);
    expect(await test()).toEqual({ kind: "skipped", reason: "no_credentials" });
    expect(calls).toHaveLength(0);
    expect(await notice()).toBeUndefined();
  });

  it("is refused for a supplier that is gone", async () => {
    expect(await createAutoLoginTestHandler(testDeps())({ supplierId: "00000000-0000-4000-8000-000000000000" })).toEqual({ kind: "skipped", reason: "no_supplier" });
    expect(calls).toHaveLength(0);
  });
});

describe("a supplier that emails a login code", () => {
  const HOLD = "11111111-2222-4333-8444-555555555555";
  const needed: LoginCallOutcome = { ok: true, outcome: { result: "code_needed", holdId: HOLD } };
  const inbox = (mails: Mail[]): MailSource => async () => mails;
  const fresh = (over: Partial<Mail> = {}): Mail => ({ from: "noreply@acme.example", arrived: new Date(), subject: "Your code", text: "Your verification code is 482913.", ...over });
  const codes = (source: MailSource) => ({ codes: { source, timeoutMs: 50, pollMs: 10 } });

  it("asks for codes only when it can read them", async () => {
    await ensureLoggedIn(deps(), await supplier(), opts);
    expect(calls[0]?.codeWanted).toBeUndefined();
    await ensureLoggedIn(deps(codes(inbox([]))), await supplier(), opts);
    expect(calls[1]?.codeWanted).toBe(true);
  });

  it("reads the code from the supplier's email, sends it, and keeps the login", async () => {
    replies = [needed];
    expect(await ensureLoggedIn(deps(codes(inbox([fresh()]))), await supplier(), opts)).toBe("ready");
    expect(codeCalls).toEqual([{ holdId: HOLD, code: "482913" }]);
    expect(await stored()).toEqual(NEW);
    expect(logLines.join("")).toContain("code: found from=acme.example");
    expect(logLines.join("")).not.toContain("482913");
  });

  it("with no code in time, ends the wait and stops as code_required", async () => {
    replies = [needed];
    expect(await ensureLoggedIn(deps(codes(inbox([]))), await supplier(), opts)).toBe("login_required");
    expect(codeCalls).toEqual([{ holdId: HOLD, cancelled: true }]);
    expect((await notice())?.reason).toBe("code_required");
    expect((await supplier()).autoLoginFailures).toBe(1);
  });

  it("a code the supplier refuses is code_required", async () => {
    replies = [needed];
    expect(await ensureLoggedIn(deps(codes(inbox([fresh({ text: "Your code is 111111" })]))), await supplier(), opts)).toBe("login_required");
    expect((await notice())?.reason).toBe("code_required");
  });

  it("uses the supplier's code email sender", async () => {
    await suppliers().setAutoLogin(id, { codeEmailFrom: "login.example.net" });
    expect((await supplier()).codeEmailFrom).toBe("login.example.net");
    replies = [needed];
    const mail = [fresh({ from: "codes@login.example.net" })];
    expect(await ensureLoggedIn(deps(codes(inbox(mail))), await supplier(), opts)).toBe("ready");
    await suppliers().setAutoLogin(id, { codeEmailFrom: null });
    expect((await supplier()).codeEmailFrom).toBeNull();
  });
});
