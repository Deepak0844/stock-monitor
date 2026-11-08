import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { sealSessionState } from "@stock-monitor/supplier-session";
import { startTestDb, type TestDb } from "./harness.js";
import { createSupplierRepository } from "../src/supplier-repository.js";
import { createSupplierSessionRepository } from "../src/supplier-session-repository.js";

let t: TestDb;
const key = randomBytes(32);
const sessions = () => createSupplierSessionRepository(t.appDb);
const suppliers = () => createSupplierRepository(t.appDb);
let a = "";
let b = "";

beforeAll(async () => {
  t = await startTestDb();
}, 180_000);
afterAll(async () => {
  await t?.stop();
});
beforeEach(async () => {
  await t.pool.query("truncate suppliers cascade");
  const x = await suppliers().create({ name: "Acme", websiteUrl: "https://acme.example/", loginUrl: null, checkIntervalMinutes: 60 });
  const y = await suppliers().create({ name: "Globex", websiteUrl: "https://globex.example/", loginUrl: null, checkIntervalMinutes: 60 });
  if (!x.ok || !y.ok) throw new Error("setup");
  a = x.supplier.id;
  b = y.supplier.id;
});

const COOKIE = "COOKIE-SECRET-VALUE-91ab";
const TOKEN = "LOCALSTORAGE-SECRET-VALUE-33cd";
const state = (domain = "shop.acme.example") => ({
  cookies: [
    { name: "session", value: COOKIE, domain, path: "/" },
    { name: "cart", value: "1", domain: `.${domain}`, path: "/" },
  ],
  origins: [{ origin: `https://${domain}`, localStorage: [{ name: "auth", value: TOKEN }] }],
});
const seal = (s = state()) => ({ sealed: sealSessionState(s, key, "v1"), state: s });

describe("saving a session", () => {
  it("keeps it sealed, with plain facts about it and nothing readable", async () => {
    const { sealed, state: s } = seal();
    await sessions().save(a, sealed, s);
    const raw = JSON.stringify((await t.pool.query("select * from supplier_sessions")).rows);
    for (const secret of [COOKIE, TOKEN, "cookies", "localStorage"]) expect(raw).not.toContain(secret);
    expect(await sessions().facts(a)).toMatchObject({ cookieCount: 2, domains: ["shop.acme.example"], sizeBytes: expect.any(Number) });
  });

  it("hands the sealed form back for the check, and that is the only way to read it", async () => {
    const { sealed, state: s } = seal();
    await sessions().save(a, sealed, s);
    expect(await sessions().getSealed(a)).toEqual(sealed);
    expect(JSON.stringify(await sessions().facts(a))).not.toContain(sealed.ciphertext);
  });

  it("keeps one session per supplier, and a new login replaces the old", async () => {
    await sessions().save(a, ...(({ sealed, state: s }) => [sealed, s] as const)(seal(state("old.acme.example"))));
    const first = await sessions().facts(a);
    await sessions().save(a, ...(({ sealed, state: s }) => [sealed, s] as const)(seal(state("new.acme.example"))));
    expect((await t.pool.query("select count(*)::int as n from supplier_sessions")).rows[0].n).toBe(1);
    const second = await sessions().facts(a);
    expect(second?.domains).toEqual(["new.acme.example"]);
    expect(second!.savedAt.getTime()).toBeGreaterThanOrEqual(first!.savedAt.getTime());
    expect(second?.lastVerifiedAt).toBeNull();
  });

  it("keeps suppliers' sessions apart", async () => {
    const x = seal(state("acme.example"));
    const y = seal(state("globex.example"));
    await sessions().save(a, x.sealed, x.state);
    await sessions().save(b, y.sealed, y.state);
    expect(await sessions().getSealed(a)).toEqual(x.sealed);
    expect(await sessions().getSealed(b)).toEqual(y.sealed);
  });

  it("answers null for a supplier with no session", async () => {
    expect(await sessions().facts(a)).toBeNull();
    expect(await sessions().getSealed(a)).toBeNull();
  });

  it("removes a session, and says whether there was one", async () => {
    const { sealed, state: s } = seal();
    await sessions().save(a, sealed, s);
    expect(await sessions().remove(a)).toBe(true);
    expect(await sessions().remove(a)).toBe(false);
    expect(await sessions().getSealed(a)).toBeNull();
  });

  it("is removed with its supplier", async () => {
    const { sealed, state: s } = seal();
    await sessions().save(a, sealed, s);
    await suppliers().remove(a);
    expect((await t.pool.query("select count(*)::int as n from supplier_sessions")).rows[0].n).toBe(0);
  });
});

describe("a supplier that has just been connected", () => {
  it("becomes connected, and a pause the app made is lifted", async () => {
    await t.pool.query("update suppliers set session_status = 'needs_reconnect', enabled = false, paused_reason = 'session' where id = $1", [a]);
    expect(await suppliers().markConnected(a)).toMatchObject({ sessionStatus: "connected", enabled: true, pausedReason: null });
  });

  it("stays paused when the owner paused it", async () => {
    await suppliers().pause(a);
    expect(await suppliers().markConnected(a)).toMatchObject({ sessionStatus: "connected", enabled: false, pausedReason: "owner" });
  });

  it("changes no other supplier, and answers null for an unknown one", async () => {
    await suppliers().markConnected(a);
    expect((await suppliers().get(b))?.sessionStatus).toBe("not_connected");
    expect(await suppliers().markConnected("00000000-0000-4000-8000-000000000000")).toBeNull();
  });

  it("goes back to not connected when the session is removed", async () => {
    await suppliers().markConnected(a);
    expect(await suppliers().markNotConnected(a)).toMatchObject({ sessionStatus: "not_connected" });
  });
});
