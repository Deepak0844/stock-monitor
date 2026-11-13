import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { Writable } from "node:stream";
import { startTestDb, type TestDb } from "@stock-monitor/db/test-harness";
import { createCheckRunRepository, createMappingRepository, createObservationRepository, createRecipeRepository, createSupplierRepository, createSupplierSessionRepository } from "@stock-monitor/db";
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
    mappings: { mappings: createMappingRepository(t.appDb), suppliers: createSupplierRepository(t.appDb), observations: createObservationRepository(t.appDb) },
    stockChecks: {
      mappings: createMappingRepository(t.appDb),
      suppliers: createSupplierRepository(t.appDb),
      supplierSessions: createSupplierSessionRepository(t.appDb),
      recipes: createRecipeRepository(t.appDb),
      observations: createObservationRepository(t.appDb),
      checkRuns: createCheckRunRepository(t.appDb),
      queue: {
        enqueue: async (name: string, payload: unknown, options?: unknown) => {
          if (enqueueFails) throw new Error("queue down");
          queued.push({ name, payload, ...(options ? { options } : {}) });
        },
      } as never,
    },
  });

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
async function call(method: "GET" | "POST", url: string, cookie = true) {
  const res = await app().inject({ method, url, cookies: cookie ? { sid } : {} });
  return { status: res.statusCode, body: res.json() as Json };
}
const suppliers = () => createSupplierRepository(t.appDb);
const events = async (action: string) => (await t.pool.query("select entity_id, details from audit_events where action = $1", [action])).rows;
const turnOn = async () => {
  const r = await createRecipeRepository(t.appDb).create(acme, { pageChecks: [{ type: "text", text: "Blue Tee" }], inStock: [], outOfStock: [] });
  await createRecipeRepository(t.appDb).activate(r.id);
};

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
  const s = await suppliers().create({ name: "Acme", websiteUrl: "https://shop.acme.example/", loginUrl: null, checkIntervalMinutes: 60 });
  if (!s.ok) throw new Error("setup");
  acme = s.supplier.id;
  const state = { cookies: [], origins: [] };
  await createSupplierSessionRepository(t.appDb).save(acme, sealSessionState(state, key, "v1"), state);
  await suppliers().markConnected(acme);
  await suppliers().setPermission(acme, { status: "granted", note: null });
  await t.pool.query(
    `insert into shopify_variants (variant_id, product_id, product_title, variant_title, options, sku, inventory_item_id, tracked, inventory_policy)
     values ('v1', 'p1', 'Tee', 'L', '[]', 'S1', 'i1', true, 'DENY')`,
  );
  const m = await createMappingRepository(t.appDb).create({ variantId: "v1", supplierId: acme, url: "https://shop.acme.example/p", note: null });
  if (!m.ok) throw new Error("setup");
  linkId = m.mapping.id;
  await turnOn();
});

describe("every stock check route needs a signed-in owner", () => {
  it.each([["POST", "/api/mappings/x/check-stock"], ["POST", "/api/suppliers/x/check-stock"], ["GET", "/api/mappings/x/observations"]])("%s %s returns 401", async (method, url) => {
    expect((await call(method as "GET", url, false)).status).toBe(401);
  });
});

describe("check one link", () => {
  it("queues a job that carries only the link's id, and audits the request", async () => {
    const r = await call("POST", `/api/mappings/${linkId}/check-stock`);
    expect(r).toMatchObject({ status: 202, body: { queued: true } });
    expect(queued).toEqual([{ name: "extraction.check", payload: { mappingId: linkId } }]);
    expect((await events("mapping.stock_check_requested"))[0]).toMatchObject({ entity_id: linkId });
  });

  it.each([
    ["permission is not recorded", () => suppliers().setPermission(acme, { status: "unknown", note: null }), "no_permission", /recorded permission/],
    ["the supplier is paused", () => suppliers().pause(acme), "paused", /paused/],
    ["the supplier has no login", () => createSupplierSessionRepository(t.appDb).remove(acme), "not_connected", /not connected/],
    ["no stock rules are turned on", () => t.pool.query("update stock_recipes set active = false"), "no_recipe", /Turn on stock rules/],
  ])("refuses in plain words when %s, and queues nothing", async (_n, change, code, message) => {
    await change();
    const r = await call("POST", `/api/mappings/${linkId}/check-stock`);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe(code);
    expect(r.body.error.message).toMatch(message);
    expect(queued).toHaveLength(0);
  });

  it("refuses a link the owner switched off, and an unknown link", async () => {
    await createMappingRepository(t.appDb).update(linkId, { enabled: false });
    expect((await call("POST", `/api/mappings/${linkId}/check-stock`)).body.error.code).toBe("link_off");
    expect((await call("POST", "/api/mappings/00000000-0000-4000-8000-000000000000/check-stock")).status).toBe(404);
  });

  it("says plainly when the check could not be started", async () => {
    enqueueFails = true;
    const r = await call("POST", `/api/mappings/${linkId}/check-stock`);
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe("check_not_started");
  });
});

describe("check all of a supplier's links", () => {
  it("starts a manual run and queues one job with only the supplier's and the run's id, with time to finish and no retry", async () => {
    const r = await call("POST", `/api/suppliers/${acme}/check-stock`);
    expect(r).toMatchObject({ status: 202, body: { queued: true, links: 1 } });
    const run = await createCheckRunRepository(t.appDb).current(acme);
    expect(run).toMatchObject({ trigger: "manual", linksTotal: 1, outcome: "running" });
    expect(r.body.runId).toBe(run?.id);
    expect(queued).toEqual([{ name: "extraction.checks", payload: { supplierId: acme, runId: run?.id }, options: { expireInSeconds: 900, retryLimit: 0 } }]);
  });
  it("refuses a second run while one is going, with a plain message, and queues nothing more", async () => {
    await call("POST", `/api/suppliers/${acme}/check-stock`);
    const second = await call("POST", `/api/suppliers/${acme}/check-stock`);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("run_in_progress");
    expect(second.body.error.message).toMatch(/already running/);
    expect(queued).toHaveLength(1);
  });
  it("two presses at the same moment start one run", async () => {
    const both = await Promise.all([call("POST", `/api/suppliers/${acme}/check-stock`), call("POST", `/api/suppliers/${acme}/check-stock`)]);
    expect(both.map((r) => r.status).sort()).toEqual([202, 409]);
    expect(queued).toHaveLength(1);
  });
  it("ends the run as failed when the queue is down, so the next press is not refused", async () => {
    enqueueFails = true;
    expect((await call("POST", `/api/suppliers/${acme}/check-stock`)).status).toBe(503);
    expect(await createCheckRunRepository(t.appDb).current(acme)).toBeNull();
    expect((await createCheckRunRepository(t.appDb).recent(acme, 1))[0]).toMatchObject({ outcome: "failed", stopReason: "not_queued" });
    enqueueFails = false;
    expect((await call("POST", `/api/suppliers/${acme}/check-stock`)).status).toBe(202);
  });
  it("sizes the job for a long run", async () => {
    await suppliers().setPermission(acme, { status: "granted", note: null, pauseSeconds: 60 });
    for (let n = 2; n <= 60; n++) {
      await t.pool.query(
        `insert into shopify_variants (variant_id, product_id, product_title, variant_title, options, sku, inventory_item_id, tracked, inventory_policy)
         values ($1, 'p1', 'T', 'V', '[]', $1, $1, true, 'DENY')`,
        [`w${n}`],
      );
      await createMappingRepository(t.appDb).create({ variantId: `w${n}`, supplierId: acme, url: `https://shop.acme.example/p/${n}`, note: null });
    }
    await call("POST", `/api/suppliers/${acme}/check-stock`);
    expect(queued[0]?.options).toEqual({ expireInSeconds: 60 * (60 + 120), retryLimit: 0 });
  });
  it("is refused when the supplier is not allowed or has no rules on, or has no links, or is unknown", async () => {
    await t.pool.query("update stock_recipes set active = false");
    expect((await call("POST", `/api/suppliers/${acme}/check-stock`)).body.error.code).toBe("no_recipe");
    await turnOn();
    await createMappingRepository(t.appDb).remove(linkId);
    expect((await call("POST", `/api/suppliers/${acme}/check-stock`)).body.error.code).toBe("no_links");
    expect((await call("POST", "/api/suppliers/00000000-0000-4000-8000-000000000000/check-stock")).status).toBe(404);
    expect(queued).toHaveLength(0);
  });
});

describe("reading the answers", () => {
  const add = (answer: string, quantity: number | null = null, reason: string | null = null) =>
    createObservationRepository(t.appDb).append({ mappingId: linkId, answer: answer as never, reason, quantity, matchedText: "Add to cart", quantityMismatch: false, recipeVersion: 1, checkResult: "ok", captureId: null });

  it("lists a link's history newest first, and says plainly when the link is unknown", async () => {
    await add("out_of_stock", 0);
    await add("in_stock", 5);
    const r = await call("GET", `/api/mappings/${linkId}/observations`);
    expect(r.body.observations.map((o: Json) => o.answer)).toEqual(["in_stock", "out_of_stock"]);
    expect(r.body.observations[0]).toMatchObject({ quantity: 5, matchedText: "Add to cart", recipeVersion: 1 });
    expect((await call("GET", "/api/mappings/00000000-0000-4000-8000-000000000000/observations")).status).toBe(404);
  });

  it("puts the latest answer on each link in the links list", async () => {
    expect((await call("GET", "/api/mappings")).body.mappings[0].latestStock).toBeNull();
    await add("out_of_stock", 0);
    await add("in_stock", 5);
    expect((await call("GET", "/api/mappings")).body.mappings[0].latestStock).toMatchObject({ answer: "in_stock", quantity: 5, reason: null, matchedText: "Add to cart" });
  });
});
