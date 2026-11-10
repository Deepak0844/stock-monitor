import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { Writable } from "node:stream";
import { startTestDb, type TestDb } from "@stock-monitor/db/test-harness";
import { createCaptureRepository, createMappingRepository, createSupplierRepository, createSupplierSessionRepository } from "@stock-monitor/db";
import { createLogger } from "@stock-monitor/shared";
import { sealSessionState } from "@stock-monitor/supplier-session";
import { buildApp } from "../src/app.js";

let t: TestDb;
let sid: string;
let acme = "";
let globex = "";
let link = "";
const queued: { name: string; payload: unknown }[] = [];
let enqueueFails = false;
const key = randomBytes(32);
const logger = createLogger({ level: "silent", stream: new Writable({ write: (_c, _e, cb) => cb() }) });
const app = () =>
  buildApp({
    db: t.appDb,
    logger,
    captures: {
      captures: createCaptureRepository(t.appDb),
      mappings: createMappingRepository(t.appDb),
      suppliers: createSupplierRepository(t.appDb),
      supplierSessions: createSupplierSessionRepository(t.appDb),
      queue: {
        enqueue: async (name: string, payload: unknown) => {
          if (enqueueFails) throw new Error("queue down");
          queued.push({ name, payload });
        },
      } as never,
    },
  });

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
async function call(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: unknown, cookie = true) {
  const res = await app().inject({ method, url, payload: payload as never, cookies: cookie ? { sid } : {} });
  return { status: res.statusCode, headers: res.headers, raw: res.rawPayload, body: (res.headers["content-type"] ?? "").toString().includes("json") ? (res.json() as Json) : ({} as Json) };
}
const suppliers = () => createSupplierRepository(t.appDb);
const captures = () => createCaptureRepository(t.appDb);
const description = { url: "https://shop.example/p", title: "Blue Tee", status: 200, pageClass: "ok", sections: [{ heading: "Blue Tee", level: 1, lines: ["<script>alert(1)</script>"] }], buttons: [] };
const events = async (action: string) => (await t.pool.query("select entity_id, details from audit_events where action = $1", [action])).rows;

async function readySupplier(name: string, host: string) {
  const s = await suppliers().create({ name, websiteUrl: `https://${host}/`, loginUrl: null, checkIntervalMinutes: 60 });
  if (!s.ok) throw new Error("setup");
  const state = { cookies: [], origins: [] };
  await createSupplierSessionRepository(t.appDb).save(s.supplier.id, sealSessionState(state, key, "v1"), state);
  await suppliers().markConnected(s.supplier.id);
  await suppliers().setPermission(s.supplier.id, { status: "granted", note: null });
  return s.supplier.id;
}

beforeAll(async () => {
  t = await startTestDb();
  const user = await t.pool.query("insert into users (email, password_hash) values ('owner@example.com', 'h') returning id");
  sid = randomBytes(32).toString("hex");
  await t.pool.query("insert into app_sessions (user_id, token_hash, expires_at) values ($1, $2, now() + interval '1 day')", [user.rows[0].id, createHash("sha256").update(sid).digest("hex")]);
}, 180_000);
afterAll(async () => {
  await t?.stop();
});
beforeEach(async () => {
  await t.pool.query("truncate suppliers, shopify_variants, audit_events cascade");
  queued.length = 0;
  enqueueFails = false;
  acme = await readySupplier("Acme", "shop.acme.example");
  globex = await readySupplier("Globex", "globex.example");
  await t.pool.query(
    `insert into shopify_variants (variant_id, product_id, product_title, variant_title, options, sku, inventory_item_id, tracked, inventory_policy)
     values ('v1', 'p1', 'Tee', 'L', '[]', 'S1', 'i1', true, 'DENY')`,
  );
  const m = await createMappingRepository(t.appDb).create({ variantId: "v1", supplierId: acme, url: "https://shop.acme.example/p", note: null });
  if (!m.ok) throw new Error("setup");
  link = m.mapping.id;
});

describe("every capture route needs a signed-in owner", () => {
  const routes: [string, string][] = [
    ["POST", "/api/suppliers/x/captures"], ["GET", "/api/suppliers/x/captures"], ["GET", "/api/captures/x"],
    ["GET", "/api/captures/x/picture"], ["PATCH", "/api/captures/x"], ["DELETE", "/api/captures/x"],
  ];
  it.each(routes)("%s %s returns 401 without a session", async (method, url) => {
    expect((await call(method as "GET", url, undefined, false)).status).toBe(401);
  });
});

describe("asking for a capture", () => {
  it("makes a pending capture, queues a job that carries only its id, and audits it", async () => {
    const r = await call("POST", `/api/suppliers/${acme}/captures`, { mappingId: link, name: "Blue Tee" });
    expect(r.status).toBe(202);
    expect(r.body.capture).toMatchObject({ status: "pending", name: "Blue Tee", supplierId: acme, mappingId: link });
    expect(queued).toEqual([{ name: "extraction.capture", payload: { captureId: r.body.capture.id } }]);
    expect((await events("capture.requested"))[0]).toMatchObject({ entity_id: r.body.capture.id });
  });

  it.each([
    ["permission is not recorded", () => suppliers().setPermission(acme, { status: "unknown", note: null }), "no_permission", /recorded permission/],
    ["the supplier is paused", () => suppliers().pause(acme), "paused", /paused/],
    ["the supplier has no login", () => createSupplierSessionRepository(t.appDb).remove(acme), "not_connected", /not connected/],
  ])("refuses in plain words when %s, and queues nothing", async (_n, change, code, message) => {
    await change();
    const r = await call("POST", `/api/suppliers/${acme}/captures`, { mappingId: link });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe(code);
    expect(r.body.error.message).toMatch(message);
    expect(queued).toHaveLength(0);
  });

  it("refuses a link that belongs to another supplier, an unknown link and an unknown supplier", async () => {
    expect((await call("POST", `/api/suppliers/${globex}/captures`, { mappingId: link })).body.error.code).toBe("link_not_found");
    expect((await call("POST", `/api/suppliers/${acme}/captures`, { mappingId: "00000000-0000-4000-8000-000000000000" })).body.error.code).toBe("link_not_found");
    expect((await call("POST", "/api/suppliers/00000000-0000-4000-8000-000000000000/captures", { mappingId: link })).status).toBe(404);
    expect(queued).toHaveLength(0);
  });

  it("refuses a missing link, an unknown field and a name that is too long", async () => {
    expect((await call("POST", `/api/suppliers/${acme}/captures`, {})).status).toBe(400);
    expect((await call("POST", `/api/suppliers/${acme}/captures`, { mappingId: link, extra: 1 })).status).toBe(400);
    expect((await call("POST", `/api/suppliers/${acme}/captures`, { mappingId: link, name: "x".repeat(201) })).body.error.code).toBe("invalid_name");
  });

  it("says plainly when the capture could not be started, and leaves no capture behind", async () => {
    enqueueFails = true;
    const r = await call("POST", `/api/suppliers/${acme}/captures`, { mappingId: link });
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe("capture_not_started");
    expect(await captures().list(acme)).toEqual([]);
  });

  it("deletes captures older than 30 days when a new one is asked for", async () => {
    const old = await captures().create({ supplierId: acme, mappingId: link, name: "old" });
    await t.pool.query("update page_captures set created_at = now() - interval '31 days' where id = $1", [old.id]);
    await call("POST", `/api/suppliers/${acme}/captures`, { mappingId: link });
    expect(await captures().get(old.id)).toBeNull();
  });
});

describe("reading and changing captures", () => {
  const ready = async () => {
    const c = await captures().create({ supplierId: acme, mappingId: link, name: "Blue Tee" });
    await captures().fill(c.id, { status: "ready", pageClass: "ok", description, picture: Buffer.from("PNG-bytes") });
    return c.id;
  };

  it("lists a supplier's captures without the page text or picture", async () => {
    await ready();
    const r = await call("GET", `/api/suppliers/${acme}/captures`);
    expect(r.body.captures).toHaveLength(1);
    expect(JSON.stringify(r.body)).not.toContain("script");
    expect(r.body.captures[0]).toMatchObject({ status: "ready", hasPicture: true });
  });

  it("gives one capture's description as data, and its picture as a private image", async () => {
    const id = await ready();
    expect((await call("GET", `/api/captures/${id}`)).body.capture.description).toMatchObject({ title: "Blue Tee" });
    const pic = await call("GET", `/api/captures/${id}/picture`);
    expect(pic.status).toBe(200);
    expect(pic.headers["content-type"]).toBe("image/png");
    expect(pic.headers["cache-control"]).toBe("private, no-store");
    expect(pic.raw.toString()).toBe("PNG-bytes");
  });

  it("a capture with no picture, an unknown capture and a made-up id are plain 404s", async () => {
    const c = await captures().create({ supplierId: acme, mappingId: link, name: "" });
    expect((await call("GET", `/api/captures/${c.id}/picture`)).body.error.code).toBe("picture_not_found");
    expect((await call("GET", "/api/captures/00000000-0000-4000-8000-000000000000")).body.error.code).toBe("capture_not_found");
    expect((await call("GET", "/api/captures/not-an-id")).status).toBe(404);
  });

  it("labels a capture with a name and the answer the owner expects, and can clear it", async () => {
    const id = await ready();
    const r = await call("PATCH", `/api/captures/${id}`, { name: "Blue Tee in stock", expected: "in_stock" });
    expect(r.body.capture).toMatchObject({ name: "Blue Tee in stock", expectedAnswer: "in_stock" });
    expect((await call("PATCH", `/api/captures/${id}`, { expected: null })).body.capture.expectedAnswer).toBeNull();
    expect((await events("capture.labelled")).length).toBe(2);
  });

  it("refuses an expected answer that is not one of the three, and nothing to change", async () => {
    const id = await ready();
    expect((await call("PATCH", `/api/captures/${id}`, { expected: "maybe" })).body.error.code).toBe("invalid_expected");
    expect((await call("PATCH", `/api/captures/${id}`, {})).status).toBe(400);
  });

  it("deletes a capture and audits it", async () => {
    const id = await ready();
    expect((await call("DELETE", `/api/captures/${id}`)).status).toBe(200);
    expect(await captures().get(id)).toBeNull();
    expect((await events("capture.deleted")).length).toBe(1);
    expect((await call("DELETE", `/api/captures/${id}`)).body.error.code).toBe("capture_not_found");
  });

  it("never puts page content in the audit log", async () => {
    const id = await ready();
    await call("PATCH", `/api/captures/${id}`, { expected: "in_stock" });
    expect(JSON.stringify((await t.pool.query("select details from audit_events")).rows)).not.toContain("script");
  });
});
