import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { Writable } from "node:stream";
import { startTestDb, type TestDb } from "@stock-monitor/db/test-harness";
import { createMappingRepository, createSupplierRepository, createSupplierSessionRepository } from "@stock-monitor/db";
import { createLogger } from "@stock-monitor/shared";
import { sealSessionState } from "@stock-monitor/supplier-session";
import { buildApp } from "../src/app.js";

let t: TestDb;
let sid: string;
let acme = "";
let linkId = "";
const queued: { name: string; payload: unknown; options?: unknown }[] = [];
let enqueueFails = false;
const key = randomBytes(32);
const logger = createLogger({ level: "silent", stream: new Writable({ write: (_c, _e, cb) => cb() }) });
const app = () =>
  buildApp({
    db: t.appDb,
    logger,
    mappings: {
      mappings: createMappingRepository(t.appDb),
      suppliers: createSupplierRepository(t.appDb),
      supplierSessions: createSupplierSessionRepository(t.appDb),
      queue: {
        enqueue: async (name: string, payload: unknown, options?: unknown) => {
          if (enqueueFails) throw new Error("queue down");
          queued.push({ name, payload, ...(options ? { options } : {}) });
          return null;
        },
      } as never,
    },
  });

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
async function post(url: string, cookie = true) {
  const res = await app().inject({ method: "POST", url, cookies: cookie ? { sid } : {} });
  return { status: res.statusCode, body: res.json() as Json };
}
const suppliers = () => createSupplierRepository(t.appDb);
const events = async (action: string) => (await t.pool.query("select entity_id, details from audit_events where action = $1", [action])).rows;

beforeAll(async () => {
  t = await startTestDb();
  const user = await t.pool.query("insert into users (email, password_hash) values ('owner@example.com', 'h') returning id");
  sid = randomBytes(32).toString("hex");
  await t.pool.query("insert into app_sessions (user_id, token_hash, expires_at) values ($1, $2, now() + interval '1 day')", [
    user.rows[0].id,
    createHash("sha256").update(sid).digest("hex"),
  ]);
}, 180_000);
afterAll(async () => {
  await t?.stop();
});
beforeEach(async () => {
  await t.pool.query("truncate suppliers, shopify_variants, audit_events cascade");
  queued.length = 0;
  enqueueFails = false;
  const s = await suppliers().create({ name: "Acme", websiteUrl: "https://shop.acme.example/", loginUrl: null, checkIntervalMinutes: 60 });
  if (!s.ok) throw new Error("setup");
  acme = s.supplier.id;
  const state = { cookies: [], origins: [] };
  await createSupplierSessionRepository(t.appDb).save(acme, sealSessionState(state, key, "v1"), state);
  await suppliers().markConnected(acme);
  await suppliers().setPermission(acme, { status: "granted", note: null });
  await t.pool.query(
    `insert into shopify_variants (variant_id, product_id, product_title, variant_title, options, sku, inventory_item_id, tracked, inventory_policy)
     values ('v1', 'p1', 'Tee', 'Blue', '[]', 'S1', 'inv1', true, 'DENY')`,
  );
  const m = await createMappingRepository(t.appDb).create({ variantId: "v1", supplierId: acme, url: "https://shop.acme.example/p/1", note: null });
  if (!m.ok) throw new Error("setup");
  linkId = m.mapping.id;
});

describe("every check route needs a signed-in owner", () => {
  it.each(["/api/mappings/x/check-link", "/api/suppliers/x/check-links"])("%s returns 401", async (url) => {
    expect((await post(url, false)).status).toBe(401);
  });
});

describe("check one link", () => {
  it("queues a job that carries only the link's id, and audits the request", async () => {
    const r = await post(`/api/mappings/${linkId}/check-link`);
    expect(r).toMatchObject({ status: 202, body: { queued: true } });
    expect(queued).toEqual([{ name: "mapping.link.check", payload: { mappingId: linkId } }]);
    expect((await events("mapping.check_requested"))[0]).toMatchObject({ entity_id: linkId });
  });

  it.each([
    ["permission is not recorded", () => suppliers().setPermission(acme, { status: "unknown", note: null }), "no_permission", /recorded permission/],
    ["permission is refused", () => suppliers().setPermission(acme, { status: "not_granted", note: null }), "no_permission", /recorded permission/],
    ["the supplier is paused", () => suppliers().pause(acme), "paused", /paused/],
    ["the supplier has no login", () => createSupplierSessionRepository(t.appDb).remove(acme), "not_connected", /not connected/],
  ])("refuses in plain words when %s, and queues nothing", async (_name, change, code, message) => {
    await change();
    const r = await post(`/api/mappings/${linkId}/check-link`);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe(code);
    expect(r.body.error.message).toMatch(message);
    expect(queued).toHaveLength(0);
  });

  it("refuses a link the owner switched off, and an unknown link", async () => {
    await createMappingRepository(t.appDb).update(linkId, { enabled: false });
    expect((await post(`/api/mappings/${linkId}/check-link`)).body.error.code).toBe("link_off");
    expect((await post("/api/mappings/00000000-0000-4000-8000-000000000000/check-link")).status).toBe(404);
  });

  it("says plainly when the check could not be started", async () => {
    enqueueFails = true;
    const r = await post(`/api/mappings/${linkId}/check-link`);
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe("check_not_started");
  });
});

describe("check all of a supplier's links", () => {
  it("queues one job that carries only the supplier's id", async () => {
    const r = await post(`/api/suppliers/${acme}/check-links`);
    expect(r).toMatchObject({ status: 202, body: { queued: true, links: 1 } });
    expect(queued).toMatchObject([{ name: "mapping.links.check", payload: { supplierId: acme } }]);
  });
  it("lets a long run finish and never starts it twice: the job gets time for every page and no retry", async () => {
    await suppliers().setPermission(acme, { status: "granted", note: null, pauseSeconds: 60 });
    for (let n = 2; n <= 60; n++) {
      await t.pool.query(
        `insert into shopify_variants (variant_id, product_id, product_title, variant_title, options, sku, inventory_item_id, tracked, inventory_policy)
         values ($1, 'p1', 'Tee', 'V', '[]', $1, $1, true, 'DENY')`,
        [`w${n}`],
      );
      await createMappingRepository(t.appDb).create({ variantId: `w${n}`, supplierId: acme, url: `https://shop.acme.example/p/${n}`, note: null });
    }
    await post(`/api/suppliers/${acme}/check-links`);
    // 60 links, a 60 second pause and some time for each page itself: well over the queue's default 15 minutes.
    expect(queued[0]?.options).toEqual({ expireInSeconds: 60 * (60 + 120), retryLimit: 0 });
  });
  it("refuses when the supplier has no recorded permission", async () => {
    await suppliers().setPermission(acme, { status: "unknown", note: null });
    const r = await post(`/api/suppliers/${acme}/check-links`);
    expect(r.status).toBe(409);
    expect(queued).toHaveLength(0);
  });
  it("is a plain 404 for an unknown supplier, and says so when there is nothing to check", async () => {
    expect((await post("/api/suppliers/00000000-0000-4000-8000-000000000000/check-links")).status).toBe(404);
    await createMappingRepository(t.appDb).remove(linkId);
    expect((await post(`/api/suppliers/${acme}/check-links`)).body.error.code).toBe("no_links");
  });
});

describe("the unavailable candidate", () => {
  it("is shown on a link that worked, then went missing on two checks six hours apart", async () => {
    const list = async () => ((await app().inject({ method: "GET", url: "/api/mappings", cookies: { sid } })).json() as Json).mappings[0];
    expect((await list()).unavailableCandidate).toBe(false);
    await t.pool.query(
      `update mappings set link_status = 'page_missing', last_worked_at = now() - interval '2 days', missing_checks = 2,
       first_missing_at = now() - interval '7 hours', last_link_check_at = now() where id = $1`,
      [linkId],
    );
    expect((await list()).unavailableCandidate).toBe(true);
    await t.pool.query("update mappings set first_missing_at = now() - interval '1 hour' where id = $1", [linkId]);
    expect((await list()).unavailableCandidate).toBe(false);
  });
});
