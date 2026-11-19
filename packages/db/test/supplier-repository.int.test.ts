import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestDb, type TestDb } from "./harness.js";
import { createSupplierRepository, type SupplierInput } from "../src/supplier-repository.js";
import { createNotificationRepository } from "../src/notification-repository.js";
import { createSupplierCredentialsRepository } from "../src/supplier-credentials-repository.js";

let t: TestDb;
// Runs as the restricted app role, like the API.
const repo = () => createSupplierRepository(t.appDb);

beforeAll(async () => {
  t = await startTestDb();
}, 180_000);
afterAll(async () => {
  await t?.stop();
});
beforeEach(async () => {
  await t.pool.query("truncate suppliers cascade");
});

const acme: SupplierInput = { name: "Acme Supply", websiteUrl: "https://acme.example/", loginUrl: null, checkIntervalMinutes: 60 };
const globex: SupplierInput = { name: "Globex", websiteUrl: "https://globex.example/", loginUrl: "https://globex.example/login", checkIntervalMinutes: 120 };

async function made(input = acme) {
  const r = await repo().create(input);
  if (!r.ok) throw new Error("setup failed");
  return r.supplier;
}

describe("supplier repository: create and read", () => {
  it("creates a supplier that is not connected, enabled and not paused", async () => {
    const s = await made();
    expect(s).toMatchObject({
      name: "Acme Supply",
      websiteUrl: "https://acme.example/",
      loginUrl: null,
      checkIntervalMinutes: 60,
      enabled: true,
      sessionStatus: "not_connected",
      pausedReason: null,
      lastSessionCheckAt: null,
    });
    expect(s.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(s.createdAt).toBeInstanceOf(Date);
  });

  it("lists suppliers by name, ignoring case", async () => {
    await made({ ...acme, name: "zebra" });
    await made({ ...acme, name: "Apple" });
    await made({ ...acme, name: "mango" });
    expect((await repo().list()).map((s) => s.name)).toEqual(["Apple", "mango", "zebra"]);
  });

  it("gets one supplier, and null for an unknown or malformed id", async () => {
    const s = await made();
    expect((await repo().get(s.id))?.name).toBe("Acme Supply");
    expect(await repo().get("00000000-0000-4000-8000-000000000000")).toBeNull();
    expect(await repo().get("not-an-id")).toBeNull();
  });
});

describe("supplier repository: names are unique", () => {
  it("refuses a second supplier with the same name, in any letter case, and says so plainly", async () => {
    await made();
    expect(await repo().create({ ...globex, name: "acme supply" })).toEqual({ ok: false, reason: "name_taken" });
    expect(await repo().list()).toHaveLength(1);
  });

  it("refuses renaming onto another supplier's name but allows keeping its own", async () => {
    const a = await made();
    await made(globex);
    expect(await repo().update(a.id, { name: "GLOBEX" })).toEqual({ ok: false, reason: "name_taken" });
    const same = await repo().update(a.id, { name: "ACME SUPPLY" });
    expect(same).toMatchObject({ ok: true, supplier: { name: "ACME SUPPLY" } });
  });
});

describe("supplier repository: update and delete", () => {
  it("changes only the fields given and moves the updated time", async () => {
    const s = await made();
    const r = await repo().update(s.id, { checkIntervalMinutes: 30, loginUrl: "https://acme.example/sign-in" });
    if (!r.ok) throw new Error("update failed");
    expect(r.supplier).toMatchObject({ name: "Acme Supply", checkIntervalMinutes: 30, loginUrl: "https://acme.example/sign-in" });
    expect(r.supplier.updatedAt.getTime()).toBeGreaterThanOrEqual(s.updatedAt.getTime());
  });

  it("clears the login address when given null", async () => {
    const s = await made(globex);
    const r = await repo().update(s.id, { loginUrl: null });
    expect(r).toMatchObject({ ok: true, supplier: { loginUrl: null } });
  });

  it("says not_found when updating an unknown supplier", async () => {
    expect(await repo().update("00000000-0000-4000-8000-000000000000", { name: "x" })).toEqual({ ok: false, reason: "not_found" });
  });

  it("deletes a supplier and reports whether anything was deleted", async () => {
    const s = await made();
    expect(await repo().remove(s.id)).toBe(true);
    expect(await repo().remove(s.id)).toBe(false);
    expect(await repo().get(s.id)).toBeNull();
  });
});

describe("supplier repository: pause and resume", () => {
  it("pausing records the owner as the reason and changes no other supplier", async () => {
    const a = await made();
    const g = await made(globex);
    const paused = await repo().pause(a.id);
    expect(paused).toMatchObject({ enabled: false, pausedReason: "owner" });
    expect(await repo().get(g.id)).toMatchObject({ enabled: true, pausedReason: null });
  });

  it("resuming clears the pause", async () => {
    const a = await made();
    await repo().pause(a.id);
    expect(await repo().resume(a.id)).toMatchObject({ enabled: true, pausedReason: null });
  });

  it("pausing twice stays paused, and an unknown supplier gives null", async () => {
    const a = await made();
    await repo().pause(a.id);
    expect(await repo().pause(a.id)).toMatchObject({ enabled: false, pausedReason: "owner" });
    expect(await repo().pause("00000000-0000-4000-8000-000000000000")).toBeNull();
    expect(await repo().resume("00000000-0000-4000-8000-000000000000")).toBeNull();
  });
});

describe("suppliers table: the database enforces the rules too", () => {
  const insert = (extra: string, values: string) =>
    t.pool.query(`insert into suppliers (name, website_url, check_interval_minutes${extra}) values ('x', 'https://x.example/', 60${values})`);

  it("refuses an unknown session status", async () => {
    await expect(insert(", session_status", ", 'great'")).rejects.toThrow(/suppliers_session_status/);
  });
  it("refuses a check interval outside 15 to 1440 minutes", async () => {
    await expect(t.pool.query("insert into suppliers (name, website_url, check_interval_minutes) values ('a', 'https://a.example/', 5)")).rejects.toThrow(/interval/);
    await expect(t.pool.query("insert into suppliers (name, website_url, check_interval_minutes) values ('b', 'https://b.example/', 2000)")).rejects.toThrow(/interval/);
  });
  it("refuses a pause reason on an enabled supplier and a disabled supplier with no reason", async () => {
    await expect(insert(", paused_reason", ", 'owner'")).rejects.toThrow(/suppliers_pause/);
    await expect(insert(", enabled", ", false")).rejects.toThrow(/suppliers_pause/);
  });
  it("refuses an unknown pause reason", async () => {
    await expect(insert(", enabled, paused_reason", ", false, 'whim'")).rejects.toThrow(/suppliers_pause|paused_reason/);
  });
});

describe("supplier repository: page", () => {
  const many = async (n: number) => {
    for (let i = 1; i <= n; i++) {
      const r = await repo().create({ ...acme, name: `Supplier ${String(i).padStart(2, "0")}`, websiteUrl: `https://s${i}.example/` });
      if (!r.ok) throw new Error("setup failed");
    }
  };

  it("returns one page in name order with the total", async () => {
    await many(25);
    const page = await repo().page({ page: 2, pageSize: 10 });
    expect(page.total).toBe(25);
    expect(page.items.map((s) => s.name)).toEqual(Array.from({ length: 10 }, (_, i) => `Supplier ${String(i + 11).padStart(2, "0")}`));
  });

  it("returns an empty page, with the total, past the last page", async () => {
    await many(3);
    expect(await repo().page({ page: 5, pageSize: 10 })).toMatchObject({ items: [], total: 3 });
  });

  it("searches name and website, ignoring case, and treats % and _ as plain characters", async () => {
    await made({ ...acme, name: "50% Off Traders", websiteUrl: "https://off.example/" });
    await made({ ...globex, name: "Globex" });
    expect((await repo().page({ page: 1, pageSize: 10, search: "50%" })).items.map((s) => s.name)).toEqual(["50% Off Traders"]);
    expect((await repo().page({ page: 1, pageSize: 10, search: "GLOBEX.EXAMPLE" })).items.map((s) => s.name)).toEqual(["Globex"]);
    expect((await repo().page({ page: 1, pageSize: 10, search: "_" })).total).toBe(0);
    expect((await repo().page({ page: 1, pageSize: 10, search: "it's \\ \"quoted\"" })).total).toBe(0);
  });

  it("filters by what the owner sees: paused wins, a session pause shows the session state", async () => {
    const a = await made({ ...acme, name: "Ashgrove" });
    const b = await made({ ...globex, name: "Bramley" });
    const c = await made({ ...acme, name: "Cole", websiteUrl: "https://cole.example/" });
    await t.pool.query("update suppliers set session_status = 'connected' where id = $1", [a.id]);
    await t.pool.query("update suppliers set enabled = false, paused_reason = 'owner', session_status = 'connected' where id = $1", [b.id]);
    await t.pool.query("update suppliers set enabled = false, paused_reason = 'session', session_status = 'needs_reconnect' where id = $1", [c.id]);
    const names = async (status: "connected" | "needs_reconnect" | "blocked" | "paused" | "not_connected") =>
      (await repo().page({ page: 1, pageSize: 10, status })).items.map((s) => s.name);
    expect(await names("connected")).toEqual(["Ashgrove"]);
    expect(await names("paused")).toEqual(["Bramley"]);
    expect(await names("needs_reconnect")).toEqual(["Cole"]);
    expect(await names("not_connected")).toEqual([]);
  });
});

describe("supplier repository: early session check", () => {
  it("records which run the early check was queued for, to the millisecond", async () => {
    const s = await made();
    expect(s.sessionPrecheckFor).toBeNull();
    const forRun = new Date("2026-11-13T10:15:30.123Z");
    await repo().markPrecheckQueued(s.id, forRun);
    expect((await repo().get(s.id))?.sessionPrecheckFor).toEqual(forRun);
  });
});

describe("supplier repository: automatic login", () => {
  const creds = { ciphertext: "c", iv: "i", tag: "t", keyId: "k" };
  const grant = (id: string) => repo().setPermission(id, { status: "granted", note: null });
  const save = (id: string) => createSupplierCredentialsRepository(t.appDb).save(id, creds);

  it("needs permission, then credentials, to turn auto login on", async () => {
    const s = await made();
    expect(await repo().setAutoLogin(s.id, { autoLogin: true })).toEqual({ ok: false, reason: "not_granted" });
    await grant(s.id);
    expect(await repo().setAutoLogin(s.id, { autoLogin: true })).toEqual({ ok: false, reason: "no_credentials" });
    await save(s.id);
    const r = await repo().setAutoLogin(s.id, { autoLogin: true, stealth: true, loginSelectors: { username: "#u" } });
    expect(r).toMatchObject({ ok: true, supplier: { autoLogin: true, stealth: true, loginSelectors: { username: "#u" } } });
  });

  it("saves and clears the logged-in marker, which needs no permission, and keeps it to 1 to 200 characters", async () => {
    const s = await made();
    expect(s.loggedInMarker).toBeNull();
    expect(await repo().setAutoLogin(s.id, { loggedInMarker: "Log out" })).toMatchObject({ ok: true, supplier: { loggedInMarker: "Log out" } });
    expect((await repo().get(s.id))?.loggedInMarker).toBe("Log out");
    expect(await repo().setAutoLogin(s.id, { loggedInMarker: null })).toMatchObject({ ok: true, supplier: { loggedInMarker: null } });
    await expect(t.pool.query("update suppliers set logged_in_marker = '' where id = $1", [s.id])).rejects.toThrow(/suppliers_logged_in_marker/);
    await expect(t.pool.query("update suppliers set logged_in_marker = repeat('m', 201) where id = $1", [s.id])).rejects.toThrow(/suppliers_logged_in_marker/);
  });

  it("pauses after two failed logins in a row", async () => {
    const s = await made();
    expect((await repo().recordAutoLogin(s.id, "captcha", "failed")).autoLoginPausedReason).toBeNull();
    const r = await repo().recordAutoLogin(s.id, "captcha", "failed");
    expect(r).toMatchObject({ autoLoginFailures: 2, autoLoginPausedReason: "too_many_failures", lastAutoLoginResult: "captcha" });
    expect(r.lastAutoLoginAt).toBeInstanceOf(Date);
  });

  it("pauses at once for a wrong password or a locked account", async () => {
    const a = await made();
    expect((await repo().recordAutoLogin(a.id, "wrong_password", "pause_wrong_password")).autoLoginPausedReason).toBe("wrong_password");
    const b = await made(globex);
    expect((await repo().recordAutoLogin(b.id, "account_locked", "pause_account_locked")).autoLoginPausedReason).toBe("account_locked");
  });

  it("reset zeroes failures and unchanged keeps them", async () => {
    const s = await made();
    await repo().recordAutoLogin(s.id, "captcha", "failed");
    expect((await repo().recordAutoLogin(s.id, "unreachable", "unchanged")).autoLoginFailures).toBe(1);
    expect((await repo().recordAutoLogin(s.id, "ok", "reset")).autoLoginFailures).toBe(0);
  });

  it("resume clears failures and pause", async () => {
    const s = await made();
    await repo().recordAutoLogin(s.id, "wrong_password", "pause_wrong_password");
    expect(await repo().resumeAutoLogin(s.id)).toBe(true);
    expect(await repo().get(s.id)).toMatchObject({ autoLoginFailures: 0, autoLoginPausedReason: null });
  });

  it("resume also lifts a pause the app made because the session needed attention", async () => {
    const s = await made();
    await repo().recordAutoLogin(s.id, "wrong_password", "pause_wrong_password");
    await repo().markNeedsAttention(s.id, "needs_reconnect");
    expect(await repo().resumeAutoLogin(s.id)).toBe(true);
    expect(await repo().get(s.id)).toMatchObject({ enabled: true, pausedReason: null, sessionStatus: "needs_reconnect" });
  });

  it("resume leaves a pause the owner made", async () => {
    const s = await made();
    await repo().recordAutoLogin(s.id, "wrong_password", "pause_wrong_password");
    await repo().pause(s.id);
    expect(await repo().resumeAutoLogin(s.id)).toBe(true);
    expect(await repo().get(s.id)).toMatchObject({ enabled: false, pausedReason: "owner", autoLoginPausedReason: null });
  });

  it("a live-window login (markConnected) clears the failures and the pause", async () => {
    const s = await made();
    await repo().recordAutoLogin(s.id, "wrong_password", "pause_wrong_password");
    await repo().markConnected(s.id);
    expect(await repo().get(s.id)).toMatchObject({ autoLoginFailures: 0, autoLoginPausedReason: null });
  });

  it("a plain session check (markVerified) keeps a wrong password pause", async () => {
    const s = await made();
    await repo().recordAutoLogin(s.id, "wrong_password", "pause_wrong_password");
    await repo().markVerified(s.id);
    expect(await repo().get(s.id)).toMatchObject({ autoLoginFailures: 1, autoLoginPausedReason: "wrong_password" });
  });

  it("turns auto login and stealth off when permission is revoked", async () => {
    const s = await made();
    await grant(s.id);
    await save(s.id);
    await repo().setAutoLogin(s.id, { autoLogin: true, stealth: true });
    await repo().setPermission(s.id, { status: "not_granted", note: null });
    expect(await repo().get(s.id)).toMatchObject({ autoLogin: false, stealth: false });
  });
});

describe("supplier repository: keep login alive", () => {
  it("stores the keep-alive interval with the schedule, keeps it when left out, and lists the suppliers that have it", async () => {
    const s = await made();
    const set = await repo().setSchedule(s.id, { intervalMinutes: null, window: null, nextCheckAt: null, keepAliveMinutes: 30 });
    expect(set).toMatchObject({ keepAliveMinutes: 30, keepAliveNextAt: null });
    await repo().setKeepAliveNext(s.id, new Date("2026-11-18T10:00:00Z"));
    expect((await repo().get(s.id))?.keepAliveNextAt).toEqual(new Date("2026-11-18T10:00:00Z"));
    const again = await repo().setSchedule(s.id, { intervalMinutes: 60, window: null, nextCheckAt: null });
    expect(again).toMatchObject({ keepAliveMinutes: 30, keepAliveNextAt: new Date("2026-11-18T10:00:00Z") });
    expect((await repo().keepingAlive()).map((x) => x.id)).toEqual([s.id]);
    await repo().setSchedule(s.id, { intervalMinutes: 60, window: null, nextCheckAt: null, keepAliveMinutes: null });
    expect(await repo().keepingAlive()).toEqual([]);
  });

  it("refuses an interval that is not one of the choices", async () => {
    const s = await made();
    await expect(repo().setSchedule(s.id, { intervalMinutes: null, window: null, nextCheckAt: null, keepAliveMinutes: 20 })).rejects.toThrow();
  });
});

describe("supplier repository: needs a login", () => {
  it("a new supplier needs a login", async () => expect((await made()).needsLogin).toBe(true));

  it("needs-login can be turned off and on again", async () => {
    const s = await made();
    expect((await repo().setNeedsLogin(s.id, false))?.needsLogin).toBe(false);
    expect((await repo().get(s.id))?.needsLogin).toBe(false);
    expect((await repo().setNeedsLogin(s.id, true))?.needsLogin).toBe(true);
  });

  it("keep-alive never lists a supplier that needs no login", async () => {
    const s = await made();
    await repo().setSchedule(s.id, { intervalMinutes: null, window: null, nextCheckAt: null, keepAliveMinutes: 30 });
    await repo().setNeedsLogin(s.id, false);
    expect(await repo().keepingAlive()).toEqual([]);
  });
});

describe("supplier repository: turning the login off", () => {
  const notes = () => createNotificationRepository(t.appDb);
  it("lifts a pause the app made for the login, and resolves its notice", async () => {
    const s = await made();
    await repo().markNeedsAttention(s.id, "needs_reconnect");
    await notes().raise({ kind: "supplier_needs_reconnect", supplierId: s.id, message: "Log in again.", reason: "login_required" });
    expect(await repo().setNeedsLogin(s.id, false)).toMatchObject({ needsLogin: false, enabled: true, pausedReason: null });
    expect((await notes().listOpen()).filter((n) => n.supplierId === s.id)).toEqual([]);
  });

  it("keeps a pause the owner made", async () => {
    const s = await made();
    await repo().pause(s.id);
    expect(await repo().setNeedsLogin(s.id, false)).toMatchObject({ enabled: false, pausedReason: "owner" });
  });

  it("turning the login on again changes no pause", async () => {
    const s = await made();
    await repo().setNeedsLogin(s.id, false);
    await repo().pause(s.id);
    expect(await repo().setNeedsLogin(s.id, true)).toMatchObject({ needsLogin: true, enabled: false, pausedReason: "owner" });
  });

  it("filters suppliers that need no login apart from the not connected ones", async () => {
    const a = await made();
    const g = await made(globex);
    await repo().setNeedsLogin(g.id, false);
    expect((await repo().page({ page: 1, pageSize: 10, status: "not_connected" })).items.map((s) => s.id)).toEqual([a.id]);
    expect((await repo().page({ page: 1, pageSize: 10, status: "no_login" })).items.map((s) => s.id)).toEqual([g.id]);
    await repo().pause(g.id);
    expect((await repo().page({ page: 1, pageSize: 10, status: "no_login" })).items).toEqual([]);
    expect((await repo().page({ page: 1, pageSize: 10, status: "paused" })).items.map((s) => s.id)).toEqual([g.id]);
  });
});
