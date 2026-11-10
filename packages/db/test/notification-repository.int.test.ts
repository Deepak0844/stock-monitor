import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestDb, type TestDb } from "./harness.js";
import { createNotificationRepository, type NotificationReason } from "../src/notification-repository.js";
import { createSupplierRepository } from "../src/supplier-repository.js";

let t: TestDb;
const notes = () => createNotificationRepository(t.appDb);
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

const raise = (supplierId = a, message = "Acme needs you to log in again.", reason: NotificationReason = "login_required") =>
  notes().raise({ kind: "supplier_needs_reconnect", supplierId, message, reason });
const count = async () => Number((await t.pool.query("select count(*) from notifications")).rows[0].count);

describe("raising a notification", () => {
  it("creates one that is open and unread", async () => {
    expect(await raise()).toEqual({ created: true });
    const [n] = await notes().listOpen();
    expect(n).toMatchObject({ kind: "supplier_needs_reconnect", supplierId: a, supplierName: "Acme", message: "Acme needs you to log in again.", reason: "login_required", readAt: null });
    expect(n?.createdAt).toBeInstanceOf(Date);
  });

  it("keeps one open notification per supplier however often it is raised", async () => {
    await raise();
    expect(await raise()).toEqual({ created: false });
    expect(await raise()).toEqual({ created: false });
    expect(await count()).toBe(1);
  });

  it("updates the wording of the open one when the reason changes, and keeps it read if it was read", async () => {
    await raise(a, "Acme needs you to log in again.", "login_required");
    const [first] = await notes().listOpen();
    await notes().markRead(first!.id);
    await raise(a, "Acme is asking for a puzzle.", "captcha");
    const [after] = await notes().listOpen();
    expect(after).toMatchObject({ id: first!.id, message: "Acme is asking for a puzzle.", reason: "captcha" });
    expect(after?.readAt).toBeInstanceOf(Date);
  });

  it("keeps separate suppliers separate", async () => {
    await raise(a);
    expect(await raise(b, "Globex needs you to log in again.")).toEqual({ created: true });
    expect((await notes().listOpen()).map((n) => n.supplierName).sort()).toEqual(["Acme", "Globex"]);
  });

  it("is safe when raised at the same moment: still one", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => raise()));
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(await count()).toBe(1);
  });

  it("the database refuses a second open one for the same supplier and an unknown kind", async () => {
    await raise();
    await expect(t.pool.query("insert into notifications (kind, supplier_id, message, reason) values ('supplier_needs_reconnect', $1, 'x', 'unknown')", [a])).rejects.toThrow(/notifications_one_open/);
    await expect(t.pool.query("insert into notifications (kind, supplier_id, message, reason) values ('other', $1, 'x', 'unknown')", [b])).rejects.toThrow(/notifications_kind/);
    await expect(t.pool.query("insert into notifications (kind, supplier_id, message, reason) values ('supplier_needs_reconnect', $1, 'x', 'secret text')", [b])).rejects.toThrow(/notifications_reason/);
  });
});

describe("resolving", () => {
  it("closes the open notification once, and a later problem raises a new one", async () => {
    await raise();
    expect(await notes().resolve("supplier_needs_reconnect", a)).toBe(true);
    expect(await notes().listOpen()).toEqual([]);
    expect(await notes().resolve("supplier_needs_reconnect", a)).toBe(false);
    expect(await raise()).toEqual({ created: true });
    expect(await count()).toBe(2); // the resolved one is kept as history
  });

  it("resolves only the named supplier's", async () => {
    await raise(a);
    await raise(b, "Globex needs you to log in again.");
    await notes().resolve("supplier_needs_reconnect", a);
    expect((await notes().listOpen()).map((n) => n.supplierName)).toEqual(["Globex"]);
  });
});

describe("listing and reading", () => {
  it("lists the newest first", async () => {
    await raise(a);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await raise(b, "Globex needs you to log in again.");
    expect((await notes().listOpen()).map((n) => n.supplierName)).toEqual(["Globex", "Acme"]);
  });

  it("marks one read, once, and says false for an unknown or malformed id", async () => {
    await raise();
    const [n] = await notes().listOpen();
    expect(await notes().markRead(n!.id)).toBe(true);
    expect(await notes().markRead(n!.id)).toBe(false);
    expect(await notes().markRead("00000000-0000-4000-8000-000000000000")).toBe(false);
    expect(await notes().markRead("not-an-id")).toBe(false);
  });

  it("is removed with its supplier", async () => {
    await raise();
    await suppliers().remove(a);
    expect(await count()).toBe(0);
  });
});
