import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { Writable } from "node:stream";
import { startTestDb, type TestDb } from "@stock-monitor/db/test-harness";
import { createNotificationRepository, createSupplierRepository } from "@stock-monitor/db";
import { createLogger } from "@stock-monitor/shared";
import { buildApp } from "../src/app.js";

let t: TestDb;
let sid = "";
const logger = createLogger({ level: "silent", stream: new Writable({ write: (_c, _e, cb) => cb() }) });
const notes = () => createNotificationRepository(t.appDb);
let app: ReturnType<typeof buildApp>;

beforeAll(async () => {
  t = await startTestDb();
  const user = await t.pool.query("insert into users (email, password_hash) values ('owner@example.com', 'h') returning id");
  sid = randomBytes(32).toString("hex");
  await t.pool.query("insert into app_sessions (user_id, token_hash, expires_at) values ($1, $2, now() + interval '1 day')", [user.rows[0].id, createHash("sha256").update(sid).digest("hex")]);
  app = buildApp({ db: t.appDb, logger, notifications: { repo: notes() } });
}, 180_000);
afterAll(async () => {
  await t?.stop();
});
beforeEach(async () => {
  await t.pool.query("truncate suppliers cascade");
});

type Method = "GET" | "POST";
async function call(method: Method, url: string, cookie = true) {
  const res = await app.inject({ method, url, cookies: cookie ? { sid } : {} });
  return { status: res.statusCode, body: res.json() as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}
const supplier = async (name: string) => {
  const r = await createSupplierRepository(t.appDb).create({ name, websiteUrl: `https://${name.toLowerCase()}.example/`, loginUrl: null, checkIntervalMinutes: 60 });
  if (!r.ok) throw new Error("setup");
  return r.supplier.id;
};
const raise = (supplierId: string, message: string) => notes().raise({ kind: "supplier_needs_reconnect", supplierId, message, reason: "login_required" });
const UNKNOWN = "00000000-0000-4000-8000-000000000000";

describe("notification routes need a signed-in owner", () => {
  it.each([["GET", "/api/notifications"], ["POST", `/api/notifications/${UNKNOWN}/read`]] as const)("%s %s returns 401 without a session", async (method, url) => {
    expect((await call(method, url, false)).status).toBe(401);
  });
});

describe("GET /api/notifications", () => {
  it("is empty when nothing needs attention", async () => {
    expect((await call("GET", "/api/notifications")).body).toEqual({ notifications: [] });
  });

  it("lists what needs attention, newest first, in plain words with the supplier it is about", async () => {
    const a = await supplier("Acme");
    await raise(a, "Acme needs you to log in again.");
    await new Promise((resolve) => setTimeout(resolve, 20));
    const g = await supplier("Globex");
    await raise(g, "Globex needs you to log in again.");
    const r = await call("GET", "/api/notifications");
    expect(r.status).toBe(200);
    expect(r.body.notifications.map((n: { supplierName: string }) => n.supplierName)).toEqual(["Globex", "Acme"]);
    expect(r.body.notifications[0]).toEqual({
      id: expect.any(String), kind: "supplier_needs_reconnect", supplierId: g, supplierName: "Globex",
      message: "Globex needs you to log in again.", reason: "login_required", createdAt: expect.any(String), readAt: null,
    });
  });

  it("leaves out what has been resolved", async () => {
    const a = await supplier("Acme");
    await raise(a, "Acme needs you to log in again.");
    await notes().resolve("supplier_needs_reconnect", a);
    expect((await call("GET", "/api/notifications")).body.notifications).toEqual([]);
  });
});

describe("POST /api/notifications/:id/read", () => {
  it("marks one as read and keeps it listed", async () => {
    const a = await supplier("Acme");
    await raise(a, "Acme needs you to log in again.");
    const id = (await call("GET", "/api/notifications")).body.notifications[0].id;
    expect((await call("POST", `/api/notifications/${id}/read`)).body).toEqual({ ok: true });
    expect((await call("GET", "/api/notifications")).body.notifications[0].readAt).toEqual(expect.any(String));
  });

  it("is harmless to repeat, and gives a plain 404 for an unknown or malformed id", async () => {
    const a = await supplier("Acme");
    await raise(a, "Acme needs you to log in again.");
    const id = (await call("GET", "/api/notifications")).body.notifications[0].id;
    await call("POST", `/api/notifications/${id}/read`);
    expect((await call("POST", `/api/notifications/${id}/read`)).status).toBe(200);
    for (const bad of [UNKNOWN, "not-an-id"]) {
      const r = await call("POST", `/api/notifications/${bad}/read`);
      expect(r.status).toBe(404);
      expect(r.body.error).toMatchObject({ code: "notification_not_found", message: "That message does not exist." });
    }
  });
});
