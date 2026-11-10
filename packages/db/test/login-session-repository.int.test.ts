import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestDb, type TestDb } from "./harness.js";
import { createLoginSessionRepository } from "../src/login-session-repository.js";
import { createSupplierRepository } from "../src/supplier-repository.js";
import { createLoginToken } from "@stock-monitor/supplier-session";

let t: TestDb;
const sessions = () => createLoginSessionRepository(t.appDb);
const suppliers = () => createSupplierRepository(t.appDb);
let supplierA = "";
let supplierB = "";
let userId = "";

beforeAll(async () => {
  t = await startTestDb();
  userId = (await t.pool.query("insert into users (email, password_hash) values ('o@example.com', 'h') returning id")).rows[0].id;
}, 180_000);
afterAll(async () => {
  await t?.stop();
});
beforeEach(async () => {
  await t.pool.query("truncate login_sessions, suppliers cascade");
  const a = await suppliers().create({ name: "Acme", websiteUrl: "https://acme.example/", loginUrl: null, checkIntervalMinutes: 60 });
  const b = await suppliers().create({ name: "Globex", websiteUrl: "https://globex.example/", loginUrl: null, checkIntervalMinutes: 60 });
  if (!a.ok || !b.ok) throw new Error("setup");
  supplierA = a.supplier.id;
  supplierB = b.supplier.id;
});

const inTenMinutes = () => new Date(Date.now() + 10 * 60_000);
const inFifteenMinutes = () => new Date(Date.now() + 15 * 60_000);
async function start(supplier = supplierA) {
  const { token, hash } = createLoginToken();
  const r = await sessions().create({ supplierId: supplier, tokenHash: hash, tokenExpiresAt: inTenMinutes(), startedBy: userId });
  if (!r.ok) throw new Error("setup: " + r.reason);
  return { id: r.session.id, token, hash };
}
async function ready(supplier = supplierA) {
  const s = await start(supplier);
  await sessions().markReady(s.id, { browserSessionId: "browser-1", expiresAt: inFifteenMinutes() });
  return s;
}

describe("starting a login", () => {
  it("records a login attempt that is starting, and never keeps the token", async () => {
    const { id, token, hash } = await start();
    const s = await sessions().get(id);
    expect(s).toMatchObject({ id, supplierId: supplierA, status: "starting", startedBy: userId, browserSessionId: null, tokenUsedAt: null, endedAt: null, failureReason: null });
    expect(s?.tokenExpiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(JSON.stringify(s)).not.toContain(hash);
    const raw = JSON.stringify((await t.pool.query("select * from login_sessions")).rows);
    expect(raw).not.toContain(token);
    expect(raw).toContain(hash); // only the hash is stored
  });

  it("allows only one open attempt at a time, for any supplier, and the database enforces it", async () => {
    await start(supplierA);
    const { hash } = createLoginToken();
    expect(await sessions().create({ supplierId: supplierB, tokenHash: hash, tokenExpiresAt: inTenMinutes(), startedBy: userId })).toEqual({ ok: false, reason: "open_attempt" });
    await expect(
      t.pool.query("insert into login_sessions (supplier_id, token_hash, token_expires_at) values ($1, 'x', now())", [supplierB]),
    ).rejects.toThrow(/login_sessions_one_open/);
  });

  it("allows a new attempt once the last one has ended, however it ended", async () => {
    for (const end of ["cancel", "fail", "finish"] as const) {
      const s = await ready();
      if (end === "cancel") await sessions().cancel(s.id);
      if (end === "fail") await sessions().fail(s.id, "window_failed");
      if (end === "finish") {
        await sessions().beginSaving(s.id);
        await sessions().finish(s.id);
      }
      const { hash } = createLoginToken();
      expect((await sessions().create({ supplierId: supplierB, tokenHash: hash, tokenExpiresAt: inTenMinutes(), startedBy: userId })).ok, end).toBe(true);
      await t.pool.query("update login_sessions set status = 'cancelled', ended_at = now() where status = 'starting'");
    }
  });

  it("becomes ready with the browser's window id and when the window closes by itself", async () => {
    const { id } = await start();
    const expiresAt = inFifteenMinutes();
    await sessions().markReady(id, { browserSessionId: "browser-9", expiresAt });
    expect(await sessions().get(id)).toMatchObject({ status: "ready", browserSessionId: "browser-9", expiresAt });
  });

  it("only becomes ready from starting", async () => {
    const { id } = await ready();
    expect(await sessions().markReady(id, { browserSessionId: "other", expiresAt: inFifteenMinutes() })).toBe(false);
    expect((await sessions().get(id))?.browserSessionId).toBe("browser-1");
  });

  it("answers null for an unknown or malformed id", async () => {
    expect(await sessions().get("00000000-0000-4000-8000-000000000000")).toBeNull();
    expect(await sessions().get("not-an-id")).toBeNull();
  });
});

describe("the one-time token", () => {
  it("works once, then is refused as used, and moves the attempt to connected", async () => {
    const { id, token } = await ready();
    expect(await sessions().consumeToken(id, token)).toMatchObject({ ok: true, session: { id, status: "connected" } });
    expect((await sessions().get(id))?.tokenUsedAt).toBeInstanceOf(Date);
    expect(await sessions().consumeToken(id, token)).toEqual({ ok: false, reason: "used" });
  });

  it("is refused when wrong, and a wrong try does not use up the right token", async () => {
    const { id, token } = await ready();
    expect(await sessions().consumeToken(id, createLoginToken().token)).toEqual({ ok: false, reason: "invalid" });
    expect(await sessions().consumeToken(id, "not a token")).toEqual({ ok: false, reason: "invalid" });
    expect((await sessions().consumeToken(id, token)).ok).toBe(true);
  });

  it("is refused for an unknown attempt or another attempt's token", async () => {
    const a = await ready();
    expect(await sessions().consumeToken("00000000-0000-4000-8000-000000000000", a.token)).toEqual({ ok: false, reason: "invalid" });
    expect(await sessions().consumeToken("not-an-id", a.token)).toEqual({ ok: false, reason: "invalid" });
    await sessions().cancel(a.id);
    const b = await ready(supplierB);
    expect(await sessions().consumeToken(b.id, a.token)).toEqual({ ok: false, reason: "invalid" });
  });

  it("is refused after ten minutes", async () => {
    const { id, token } = await ready();
    await t.pool.query("update login_sessions set token_expires_at = now() - interval '1 second' where id = $1", [id]);
    expect(await sessions().consumeToken(id, token)).toEqual({ ok: false, reason: "expired" });
    expect((await sessions().get(id))?.status).toBe("ready"); // an old token does not end the attempt
  });

  it("is refused before the window is ready, and after the attempt has ended", async () => {
    const starting = await start();
    expect(await sessions().consumeToken(starting.id, starting.token)).toEqual({ ok: false, reason: "not_ready" });
    await sessions().markReady(starting.id, { browserSessionId: "b", expiresAt: inFifteenMinutes() });
    await sessions().cancel(starting.id);
    expect(await sessions().consumeToken(starting.id, starting.token)).toEqual({ ok: false, reason: "not_ready" });
  });

  it("lets exactly one of many simultaneous tries win", async () => {
    const { id, token } = await ready();
    const results = await Promise.all(Array.from({ length: 12 }, () => sessions().consumeToken(id, token)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).every((r) => !r.ok && r.reason === "used")).toBe(true);
  });
});

describe("how an attempt ends", () => {
  it("saving is entered once, from ready or connected", async () => {
    const a = await ready();
    expect(await sessions().beginSaving(a.id)).toBe(true);
    expect(await sessions().beginSaving(a.id)).toBe(false);
    expect((await sessions().get(a.id))?.status).toBe("saving");
    await sessions().cancel(a.id);
    const b = await ready(supplierB);
    await sessions().consumeToken(b.id, b.token);
    expect(await sessions().beginSaving(b.id)).toBe(true);
  });

  it("finishing needs saving first, and records when it ended", async () => {
    const a = await ready();
    expect(await sessions().finish(a.id)).toBe(false);
    await sessions().beginSaving(a.id);
    expect(await sessions().finish(a.id)).toBe(true);
    expect(await sessions().get(a.id)).toMatchObject({ status: "finished", endedAt: expect.any(Date) });
  });

  it("cancelling works on any open attempt and on nothing else", async () => {
    const a = await start();
    expect(await sessions().cancel(a.id)).toBe(true);
    expect(await sessions().cancel(a.id)).toBe(false);
    expect((await sessions().get(a.id))?.status).toBe("cancelled");
    const b = await ready(supplierB);
    await sessions().beginSaving(b.id);
    await sessions().finish(b.id);
    expect(await sessions().cancel(b.id)).toBe(false);
  });

  it("failing records a reason code from a fixed list, never free text", async () => {
    const a = await ready();
    expect(await sessions().fail(a.id, "save_failed")).toBe(true);
    expect(await sessions().get(a.id)).toMatchObject({ status: "failed", failureReason: "save_failed", endedAt: expect.any(Date) });
    await expect(t.pool.query("update login_sessions set failure_reason = 'the cookie was abc123' where id = $1", [a.id])).rejects.toThrow(/failure_reason/);
  });

  it("marks attempts past their time as expired, and reports them", async () => {
    const a = await ready();
    await t.pool.query("update login_sessions set expires_at = now() - interval '1 second' where id = $1", [a.id]);
    expect(await sessions().expireOverdue()).toEqual([{ id: a.id, browserSessionId: "browser-1" }]);
    expect((await sessions().get(a.id))?.status).toBe("expired");
    expect(await sessions().expireOverdue()).toEqual([]);
    const { hash } = createLoginToken();
    expect((await sessions().create({ supplierId: supplierB, tokenHash: hash, tokenExpiresAt: inTenMinutes(), startedBy: userId })).ok).toBe(true);
  });

  it("expires an attempt stuck in starting after a minute, so a crashed API cannot block logins", async () => {
    const a = await start();
    await t.pool.query("update login_sessions set created_at = now() - interval '2 minutes' where id = $1", [a.id]);
    expect((await sessions().expireOverdue()).map((e) => e.id)).toEqual([a.id]);
  });

  it("finds the open attempt, and none when nothing is open", async () => {
    expect(await sessions().open()).toBeNull();
    const a = await ready();
    expect((await sessions().open())?.id).toBe(a.id);
    await sessions().cancel(a.id);
    expect(await sessions().open()).toBeNull();
  });

  it("is removed with its supplier", async () => {
    const a = await ready();
    await suppliers().remove(supplierA);
    expect(await sessions().get(a.id)).toBeNull();
  });
});

describe("the table", () => {
  it("refuses an unknown status", async () => {
    const a = await start();
    await expect(t.pool.query("update login_sessions set status = 'great' where id = $1", [a.id])).rejects.toThrow(/login_sessions_status/);
  });
});
