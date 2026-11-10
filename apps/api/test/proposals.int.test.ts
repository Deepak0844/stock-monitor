import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { Writable } from "node:stream";
import { startTestDb, type TestDb } from "@stock-monitor/db/test-harness";
import { createMappingRepository, createNotificationRepository, createProposalRepository, createShopifyRepository, createSupplierRepository } from "@stock-monitor/db";
import { createLogger } from "@stock-monitor/shared";
import { buildApp } from "../src/app.js";

let t: TestDb;
let sid: string;
let acme = "";
let mapping = "";
let now = new Date("2026-06-10T10:00:00Z");
const queued: { name: string; payload: unknown; options?: unknown }[] = [];
let enqueueFails = false;
const logger = createLogger({ level: "silent", stream: new Writable({ write: (_c, _e, cb) => cb() }) });
const proposals = () => createProposalRepository(t.appDb);
const app = () =>
  buildApp({
    db: t.appDb,
    logger,
    mappings: {
      mappings: createMappingRepository(t.appDb),
      suppliers: createSupplierRepository(t.appDb),
      queue: { enqueue: async (name: string, payload: unknown) => void queued.push({ name, payload }) } as never,
    },
    proposals: {
      proposals: proposals(),
      shopify: createShopifyRepository(t.appDb, { key: randomBytes(32), keyId: "k" }),
      notifications: createNotificationRepository(t.appDb),
      queue: { enqueue: async (name: string, payload: unknown, options?: unknown) => { if (enqueueFails) throw new Error("down"); queued.push({ name, payload, ...(options ? { options } : {}) }); } } as never,
      now: () => now,
    },
  });

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
async function call(method: "GET" | "POST" | "PUT" | "PATCH", url: string, payload?: unknown, cookie = true) {
  const res = await app().inject({ method, url, cookies: cookie ? { sid } : {}, ...(payload === undefined ? {} : { payload: payload as never }) });
  return { status: res.statusCode, body: res.json() as Json };
}
const events = async (action: string) => (await t.pool.query("select entity_id, details from audit_events where action = $1", [action])).rows;
const connect = (scopes: string[]) =>
  t.pool.query(
    `insert into shopify_connection (id, shop, credential_type, credentials_ciphertext, credentials_iv, credentials_tag, credentials_key_id, scopes, location_id, location_name)
     values (true, 'x.myshopify.com', 'static_token', 'c', 'i', 't', 'k', $1, 'gid://shopify/Location/1', 'Shop')
     on conflict (id) do update set scopes = $1`,
    [scopes],
  );
const WRITE = ["read_products", "read_inventory", "write_inventory"];

let n = 0;
async function suggest(over: { quantity?: number; kind?: string; tracked?: boolean; policy?: string; expiresAt?: Date } = {}) {
  const v = `v${++n}`;
  await t.pool.query(
    `insert into shopify_variants (variant_id, product_id, product_title, variant_title, options, sku, inventory_item_id, tracked, inventory_policy, available)
     values ($1, 'p1', 'Blue Tee', 'Large', '[]', 'S-${n}', $2, $3, $4, 4)`,
    [v, `i${n}`, over.tracked ?? true, over.policy ?? "DENY"],
  );
  const m = await createMappingRepository(t.appDb).create({ variantId: v, supplierId: acme, url: `https://acme.example/${v}`, note: null });
  if (!m.ok) throw new Error("setup");
  mapping = m.mapping.id;
  const r = await proposals().evaluateFor({
    variantId: v, mappingId: mapping, supplierId: acme, observationId: null, shopifyQuantitySeen: 4,
    wanted: { kind: over.kind ?? "set_zero_out_of_stock", proposedQuantity: over.quantity ?? 0 }, expiresAt: over.expiresAt ?? new Date(now.getTime() + 86_400_000),
  });
  return r.proposal!;
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
  await t.pool.query("truncate suppliers, shopify_variants, shopify_connection, app_settings, audit_events, notifications cascade");
  queued.length = 0;
  enqueueFails = false;
  now = new Date("2026-06-10T10:00:00Z");
  const s = await createSupplierRepository(t.appDb).create({ name: "Acme", websiteUrl: "https://acme.example/", loginUrl: null, checkIntervalMinutes: 60 });
  if (!s.ok) throw new Error("setup");
  acme = s.supplier.id;
  await connect(WRITE);
});

describe("every suggestion route needs a signed-in owner", () => {
  it.each([["GET", "/api/proposals"], ["GET", "/api/proposals/count"], ["POST", "/api/proposals/x/approve"], ["POST", "/api/proposals/x/reject"], ["POST", "/api/proposals/x/refresh"], ["GET", "/api/settings/proposals"], ["PUT", "/api/settings/proposals"]])("%s %s returns 401", async (method, url) => {
    expect((await call(method as "GET", url, undefined, false)).status).toBe(401);
  });
});

describe("listing", () => {
  it("lists open suggestions with the words and numbers the screen needs, and never the key", async () => {
    const p = await suggest();
    await proposals().markApproved((await suggest()).id, 0, "owner", now); // an approved one is still "waiting", so it is listed too
    const r = await call("GET", "/api/proposals");
    expect(r.status).toBe(200);
    expect(r.body.proposals).toHaveLength(2);
    expect(r.body.proposals.find((x: Json) => x.id === p.id)).toMatchObject({
      state: "open", kind: "set_zero_out_of_stock", productTitle: "Blue Tee", variantTitle: "Large", supplierName: "Acme", shopifyQuantitySeen: 4, proposedQuantity: 0, tracked: true, continueSelling: false, blockedReason: null,
    });
    expect(JSON.stringify(r.body)).not.toMatch(/idempotency|decidedBy|attempts/);
    expect(r.body.writePermission).toEqual({ state: "ready", message: expect.any(String) });
  });

  it("says in plain words why a suggestion cannot be approved: Shopify is not tracking it", async () => {
    await suggest({ tracked: false });
    expect((await call("GET", "/api/proposals")).body.proposals[0].blockedReason).toBe("Shopify is not tracking stock for this item, so changing the quantity would have no effect.");
  });

  it("flags continue-selling as a warning only", async () => {
    await suggest({ policy: "CONTINUE" });
    expect((await call("GET", "/api/proposals")).body.proposals[0]).toMatchObject({ continueSelling: true, blockedReason: null });
  });

  it("history lists decided, expired and replaced suggestions, newest first, in pages", async () => {
    const a = await suggest();
    const b = await suggest();
    await proposals().reject(a.id, "later", "owner", now);
    await proposals().reject(b.id, null, "owner", now);
    const r = await call("GET", "/api/proposals?tab=history&pageSize=1");
    expect(r.body.proposals).toHaveLength(1);
    expect(r.body.hasMore).toBe(true);
    expect((await call("GET", "/api/proposals?tab=history&page=2&pageSize=1")).body.hasMore).toBe(false);
    expect((await call("GET", "/api/proposals?tab=history")).body.proposals.map((x: Json) => x.state)).toEqual(["rejected", "rejected"]);
  });

  it("counts the open ones for the menu", async () => {
    await suggest();
    await suggest();
    expect((await call("GET", "/api/proposals/count")).body).toEqual({ open: 2 });
  });

  it("says whether Shopify allows the write", async () => {
    await connect(["read_products", "read_inventory"]);
    expect((await call("GET", "/api/proposals")).body.writePermission).toMatchObject({ state: "missing", message: "Shopify has not given this app permission to change stock yet." });
    await t.pool.query("delete from shopify_connection");
    expect((await call("GET", "/api/proposals")).body.writePermission.state).toBe("not_connected");
  });
});

describe("approve", () => {
  it("approves, queues one apply job with only the id, and audits numbers", async () => {
    const p = await suggest();
    const r = await call("POST", `/api/proposals/${p.id}/approve`, {});
    expect(r.status).toBe(200);
    expect(r.body.proposal).toMatchObject({ id: p.id, state: "approved", approvedQuantity: 0, edited: false });
    expect(JSON.stringify(r.body)).not.toMatch(/idempotency/);
    expect(queued).toEqual([{ name: "proposals.apply", payload: { proposalId: p.id }, options: { retryLimit: 0 } }]);
    expect((await events("proposal.approved"))[0]).toMatchObject({ entity_id: p.id, details: { from: 4, to: 0, edited: false } });
  });

  it("approves an edited number", async () => {
    const p = await suggest({ kind: "restock", quantity: 5 });
    const r = await call("POST", `/api/proposals/${p.id}/approve`, { quantity: 9 });
    expect(r.body.proposal).toMatchObject({ approvedQuantity: 9, edited: true });
    expect((await events("proposal.approved"))[0]!.details).toMatchObject({ to: 9, edited: true });
  });

  it("a second press, from this tab or another, queues nothing more and says it was already decided", async () => {
    const p = await suggest();
    await call("POST", `/api/proposals/${p.id}/approve`, {});
    const again = await call("POST", `/api/proposals/${p.id}/approve`, {});
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("already_decided");
    expect(queued).toHaveLength(1);
  });

  it("two presses at the same moment queue one job", async () => {
    const p = await suggest();
    const both = await Promise.all([call("POST", `/api/proposals/${p.id}/approve`, {}), call("POST", `/api/proposals/${p.id}/approve`, {})]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(queued).toHaveLength(1);
  });

  it("refuses an expired suggestion, even before the tick has marked it", async () => {
    const p = await suggest({ expiresAt: new Date(now.getTime() + 1000) });
    now = new Date(now.getTime() + 5000);
    const r = await call("POST", `/api/proposals/${p.id}/approve`, {});
    expect(r).toMatchObject({ status: 409, body: { error: { code: "expired" } } });
    expect(queued).toHaveLength(0);
  });

  it("refuses a rejected, replaced or conflicted suggestion", async () => {
    const a = await suggest();
    await proposals().reject(a.id, null, "owner", now);
    expect((await call("POST", `/api/proposals/${a.id}/approve`, {})).body.error.code).toBe("already_decided");
    const b = await suggest();
    await t.pool.query("update proposals set state = 'replaced' where id = $1", [b.id]);
    expect((await call("POST", `/api/proposals/${b.id}/approve`, {})).body.error.code).toBe("already_decided");
  });

  it("without the write permission, refuses in plain words and sends nothing", async () => {
    await connect(["read_products", "read_inventory"]);
    const p = await suggest();
    const r = await call("POST", `/api/proposals/${p.id}/approve`, {});
    expect(r).toMatchObject({ status: 409, body: { error: { code: "no_write_permission", message: "Shopify has not given this app permission to change stock yet." } } });
    expect(queued).toHaveLength(0);
    expect(await proposals().get(p.id)).toMatchObject({ state: "open" });
  });

  it("without a Shopify connection, refuses", async () => {
    const p = await suggest();
    await t.pool.query("delete from shopify_connection");
    expect((await call("POST", `/api/proposals/${p.id}/approve`, {})).body.error.code).toBe("no_write_permission");
  });

  it("refuses when Shopify is not tracking the item", async () => {
    const p = await suggest({ tracked: false });
    const r = await call("POST", `/api/proposals/${p.id}/approve`, {});
    expect(r).toMatchObject({ status: 409, body: { error: { code: "not_tracked", message: "Shopify is not tracking stock for this item, so changing the quantity would have no effect." } } });
    expect(queued).toHaveLength(0);
  });

  it.each([[-1], [1.5], ["5"], [100_001], [null]])("refuses the edited number %s with a plain reason", async (bad) => {
    const p = await suggest();
    const r = await call("POST", `/api/proposals/${p.id}/approve`, { quantity: bad });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("invalid_quantity");
    expect(queued).toHaveLength(0);
    expect(await proposals().get(p.id)).toMatchObject({ state: "open" });
  });

  it("refuses any other field in the request", async () => {
    const p = await suggest();
    expect((await call("POST", `/api/proposals/${p.id}/approve`, { quantity: 0, idempotencyKey: "x" })).status).toBe(400);
  });

  it("a queue that is down still approves: the tick will pick it up", async () => {
    const p = await suggest();
    enqueueFails = true;
    expect((await call("POST", `/api/proposals/${p.id}/approve`, {})).body.proposal).toMatchObject({ state: "approved" });
  });

  it("says plainly when the suggestion does not exist", async () => {
    for (const id of ["11111111-1111-4111-8111-111111111111", "not-an-id"]) {
      expect(await call("POST", `/api/proposals/${id}/approve`, {})).toMatchObject({ status: 404, body: { error: { code: "proposal_not_found" } } });
    }
  });
});

describe("a link that was turned off", () => {
  it("cannot be approved, and says why", async () => {
    const p = await suggest();
    await t.pool.query("update mappings set enabled = false");
    const r = await call("POST", `/api/proposals/${p.id}/approve`, {});
    expect(r).toMatchObject({ status: 409, body: { error: { code: "link_off", message: "This link was turned off, so the suggestion no longer applies." } } });
    expect(queued).toHaveLength(0);
  });

  it("turning a link off or on asks for the suggestions to be looked at again; changing only its note does not", async () => {
    await suggest();
    await call("PATCH", `/api/mappings/${mapping}`, { enabled: false });
    expect(queued).toEqual([{ name: "proposals.evaluate", payload: { mappingId: mapping } }]);
    queued.length = 0;
    await call("PATCH", `/api/mappings/${mapping}`, { enabled: true });
    expect(queued).toEqual([{ name: "proposals.evaluate", payload: { mappingId: mapping } }]);
    queued.length = 0;
    await call("PATCH", `/api/mappings/${mapping}`, { note: "x" });
    expect(queued).toEqual([]);
  });
});

describe("refresh", () => {
  const decided = async (state: "conflict" | "failed" | "expired" | "approved" | "applied" | "rejected" | "open") => {
    const p = await suggest();
    if (state !== "open") await t.pool.query("update proposals set state = $1 where id = $2", [state, p.id]);
    return p;
  };

  it.each([["conflict"], ["failed"], ["expired"]] as const)("a %s suggestion can be refreshed: Shopify is read again and the checks are looked at again", async (state) => {
    const p = await decided(state);
    const r = await call("POST", `/api/proposals/${p.id}/refresh`, {});
    expect(r).toMatchObject({ status: 202, body: { queued: true } });
    expect(queued).toEqual([{ name: "shopify.sync", payload: {} }]);
    expect((await events("proposal.refresh_requested"))[0]).toMatchObject({ entity_id: p.id });
  });

  it.each([["open"], ["approved"], ["applied"], ["rejected"]] as const)("a %s suggestion cannot be refreshed", async (state) => {
    const p = await decided(state);
    const r = await call("POST", `/api/proposals/${p.id}/refresh`, {});
    expect(r).toMatchObject({ status: 409, body: { error: { code: "cannot_refresh" } } });
    expect(queued).toEqual([]);
  });

  it("says plainly when the suggestion does not exist, and takes no body fields", async () => {
    expect((await call("POST", "/api/proposals/11111111-1111-4111-8111-111111111111/refresh", {})).status).toBe(404);
    const p = await decided("conflict");
    expect((await call("POST", `/api/proposals/${p.id}/refresh`, { quantity: 3 })).status).toBe(400);
  });

  it("a queue that is down is said plainly", async () => {
    const p = await decided("conflict");
    enqueueFails = true;
    expect(await call("POST", `/api/proposals/${p.id}/refresh`, {})).toMatchObject({ status: 503 });
  });
});

describe("reject", () => {
  it("rejects with or without a note, and audits it", async () => {
    const a = await suggest();
    const b = await suggest();
    expect((await call("POST", `/api/proposals/${a.id}/reject`, { note: "  wrong supplier  " })).body.proposal).toMatchObject({ state: "rejected", note: "wrong supplier" });
    expect((await call("POST", `/api/proposals/${b.id}/reject`, {})).body.proposal).toMatchObject({ state: "rejected", note: null });
    expect(await events("proposal.rejected")).toHaveLength(2);
    expect(queued).toHaveLength(0);
  });

  it("a second reject, or a reject after approve, is refused", async () => {
    const a = await suggest();
    await call("POST", `/api/proposals/${a.id}/reject`, {});
    expect((await call("POST", `/api/proposals/${a.id}/reject`, {})).status).toBe(409);
    const b = await suggest();
    await call("POST", `/api/proposals/${b.id}/approve`, {});
    expect((await call("POST", `/api/proposals/${b.id}/reject`, {})).status).toBe(409);
  });

  it("refuses a note that is too long or another field", async () => {
    const a = await suggest();
    expect((await call("POST", `/api/proposals/${a.id}/reject`, { note: "x".repeat(501) })).status).toBe(400);
    expect((await call("POST", `/api/proposals/${a.id}/reject`, { note: "x", extra: 1 })).status).toBe(400);
  });
});

describe("settings", () => {
  it("starts at 5 and 24 hours, saves new values, and shows the write permission", async () => {
    expect((await call("GET", "/api/settings/proposals")).body).toMatchObject({ settings: { defaultQuantity: 5, expiryHours: 24 }, writePermission: { state: "ready" } });
    const r = await call("PUT", "/api/settings/proposals", { defaultQuantity: 8, expiryHours: 12 });
    expect(r.body.settings).toEqual({ defaultQuantity: 8, expiryHours: 12 });
    expect((await call("GET", "/api/settings/proposals")).body.settings).toEqual({ defaultQuantity: 8, expiryHours: 12 });
    expect(await events("proposals.settings_changed")).toHaveLength(1);
  });

  it.each([[{ defaultQuantity: 0, expiryHours: 24 }], [{ defaultQuantity: 100_001, expiryHours: 24 }], [{ defaultQuantity: 5.5, expiryHours: 24 }], [{ defaultQuantity: 5, expiryHours: 0 }], [{ defaultQuantity: 5, expiryHours: 721 }], [{ defaultQuantity: 5 }], [{ defaultQuantity: 5, expiryHours: 24, x: 1 }]])("refuses %j", async (bad) => {
    const r = await call("PUT", "/api/settings/proposals", bad);
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("invalid_settings");
    expect((await call("GET", "/api/settings/proposals")).body.settings).toEqual({ defaultQuantity: 5, expiryHours: 24 });
  });
});
