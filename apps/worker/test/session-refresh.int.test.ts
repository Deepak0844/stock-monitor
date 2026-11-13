import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { startTestDb, type TestDb } from "@stock-monitor/db/test-harness";
import { createSupplierRepository, createSupplierSessionRepository } from "@stock-monitor/db";
import { createAuditWriter } from "@stock-monitor/audit";
import { sealSessionState, unsealSessionState, type SessionState } from "@stock-monitor/supplier-session";
import { Writable } from "node:stream";
import { createLogger } from "@stock-monitor/shared";
import { saveRefreshedSession } from "../src/session-refresh.js";

let t: TestDb;
const key = randomBytes(32);
const sessions = () => createSupplierSessionRepository(t.appDb);
const logLines: string[] = [];
const logger = createLogger({ level: "debug", stream: new Writable({ write: (c, _e, cb) => (logLines.push(c.toString()), cb()) }) });
const deps = () => ({ supplierSessions: sessions(), audit: createAuditWriter(t.appDb), key, logger });

const OLD = "OLD-COOKIE-MARKER-5e2a";
const NEW = "NEW-COOKIE-MARKER-9c4d";
const saved: SessionState = { cookies: [{ name: "sid", value: OLD, domain: "shop.acme.example", path: "/", expires: -1 }], origins: [] };
const fresh: SessionState = { cookies: [{ name: "sid", value: NEW, domain: "shop.acme.example", path: "/", expires: -1 }], origins: [] };

let id = "";
let loaded: { sealed: ReturnType<typeof sealSessionState>; state: SessionState };
beforeAll(async () => {
  t = await startTestDb();
}, 180_000);
afterAll(async () => {
  await t?.stop();
});
beforeEach(async () => {
  await t.pool.query("truncate suppliers, audit_events cascade");
  const s = await createSupplierRepository(t.appDb).create({ name: "Acme", websiteUrl: "https://shop.acme.example/", loginUrl: null, checkIntervalMinutes: 60 });
  if (!s.ok) throw new Error("setup");
  id = s.supplier.id;
  loaded = { sealed: sealSessionState(saved, key, "v1"), state: saved };
  await sessions().save(id, loaded.sealed, saved);
});

const stored = async () => unsealSessionState((await sessions().getSealed(id))!, key);
const audits = async () => (await t.pool.query("select action, details from audit_events where action = 'supplier.session_refreshed'")).rows as { details: unknown }[];

describe("saveRefreshedSession", () => {
  it("saves nothing when the check sent no session", async () => {
    expect(await saveRefreshedSession(deps(), id, loaded, undefined)).toBe("none");
    expect(await stored()).toEqual(saved);
    expect((await sessions().facts(id))?.lastVerifiedAt).toBeNull();
  });

  it("only records the check when the cookies did not change", async () => {
    expect(await saveRefreshedSession(deps(), id, loaded, saved)).toBe("unchanged");
    expect((await sessions().getSealed(id))?.iv).toBe(loaded.sealed.iv);
    expect((await sessions().facts(id))?.lastVerifiedAt).toBeInstanceOf(Date);
    expect(await audits()).toHaveLength(0);
  });

  it("saves the merged session, sealed with the same key id, and audits it without any cookie", async () => {
    expect(await saveRefreshedSession(deps(), id, loaded, fresh)).toBe("saved");
    expect(await stored()).toEqual(fresh);
    expect((await sessions().getSealed(id))?.keyId).toBe("v1");
    const rows = await audits();
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(NEW);
  });

  it("never fails the check when the save breaks: refreshing is a side task", async () => {
    const broken = { ...deps(), supplierSessions: { ...sessions(), refresh: async () => Promise.reject(new Error(`db down ${NEW}`)) } };
    expect(await saveRefreshedSession(broken, id, loaded, fresh)).toBe("failed");
    expect(await stored()).toEqual(saved);
    expect(logLines.join("")).toContain("refreshed session could not be saved");
    expect(logLines.join("")).not.toContain(NEW);
  });

  it("drops the refreshed session when the owner logged in again since the check started", async () => {
    const relogin: SessionState = { cookies: [{ name: "sid", value: "RELOGIN", domain: "shop.acme.example", path: "/", expires: -1 }], origins: [] };
    await sessions().save(id, sealSessionState(relogin, key, "v1"), relogin);
    expect(await saveRefreshedSession(deps(), id, loaded, fresh)).toBe("stale");
    expect(await stored()).toEqual(relogin);
  });
});
