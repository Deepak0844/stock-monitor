import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestDb, type TestDb } from "./harness.js";
import { createSupplierCredentialsRepository } from "../src/supplier-credentials-repository.js";
import { createSupplierRepository } from "../src/supplier-repository.js";

let t: TestDb;
const repo = () => createSupplierCredentialsRepository(t.appDb);
const suppliers = () => createSupplierRepository(t.appDb);

beforeAll(async () => {
  t = await startTestDb();
}, 180_000);
afterAll(async () => {
  await t?.stop();
});
beforeEach(async () => {
  await t.pool.query("truncate suppliers cascade");
});

const sealed = { ciphertext: "c1", iv: "i1", tag: "t1", keyId: "k1" };

async function made() {
  const r = await suppliers().create({ name: "Acme", websiteUrl: "https://acme.example/", loginUrl: null, checkIntervalMinutes: 60 });
  if (!r.ok) throw new Error("setup failed");
  return r.supplier;
}

describe("supplier credentials repository", () => {
  it("saves and reads back the same sealed value", async () => {
    const s = await made();
    const { savedAt } = await repo().save(s.id, sealed);
    expect(savedAt).toBeInstanceOf(Date);
    expect(await repo().getSealed(s.id)).toEqual(sealed);
    expect(await repo().savedAt(s.id)).toEqual(savedAt);
  });

  it("replaces on a second save", async () => {
    const s = await made();
    await repo().save(s.id, sealed);
    await repo().save(s.id, { ...sealed, iv: "i2" });
    expect((await repo().getSealed(s.id))?.iv).toBe("i2");
  });

  it("returns null when nothing is saved", async () => {
    const s = await made();
    expect(await repo().getSealed(s.id)).toBeNull();
    expect(await repo().savedAt(s.id)).toBeNull();
    expect(await repo().remove(s.id)).toBe(false);
  });

  it("removes", async () => {
    const s = await made();
    await repo().save(s.id, sealed);
    expect(await repo().remove(s.id)).toBe(true);
    expect(await repo().getSealed(s.id)).toBeNull();
  });

  it("is deleted with the supplier", async () => {
    const s = await made();
    await repo().save(s.id, sealed);
    await suppliers().remove(s.id);
    const { rows } = await t.pool.query("select 1 from supplier_credentials");
    expect(rows).toHaveLength(0);
  });

  it("clears failures and pause on save", async () => {
    const s = await made();
    await suppliers().recordAutoLogin(s.id, "wrong_password", "pause_wrong_password");
    await repo().save(s.id, sealed);
    expect(await suppliers().get(s.id)).toMatchObject({ autoLoginFailures: 0, autoLoginPausedReason: null });
  });
});

describe("saving credentials lifts a pause the app made", () => {
  const withAutoLogin = async (id: string) => {
    await suppliers().setPermission(id, { status: "granted", note: null });
    await t.pool.query("update suppliers set auto_login = true where id = $1", [id]);
  };

  it("re-enables a supplier with automatic login that the app paused because the session needed attention", async () => {
    const s = await made();
    await withAutoLogin(s.id);
    await suppliers().markNeedsAttention(s.id, "needs_reconnect");
    await repo().save(s.id, sealed);
    expect(await suppliers().get(s.id)).toMatchObject({ enabled: true, pausedReason: null, sessionStatus: "needs_reconnect" });
  });

  it("leaves the session pause when automatic login is off: the saved password will not be used", async () => {
    const s = await made();
    await suppliers().markNeedsAttention(s.id, "needs_reconnect");
    await repo().save(s.id, sealed);
    expect(await suppliers().get(s.id)).toMatchObject({ enabled: false, pausedReason: "session" });
  });

  it("leaves a pause the owner made", async () => {
    const s = await made();
    await withAutoLogin(s.id);
    await suppliers().pause(s.id);
    await repo().save(s.id, sealed);
    expect(await suppliers().get(s.id)).toMatchObject({ enabled: false, pausedReason: "owner" });
  });
});
