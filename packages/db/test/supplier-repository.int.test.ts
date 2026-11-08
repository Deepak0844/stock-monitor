import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestDb, type TestDb } from "./harness.js";
import { createSupplierRepository, type SupplierInput } from "../src/supplier-repository.js";

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
  await t.pool.query("truncate suppliers");
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
