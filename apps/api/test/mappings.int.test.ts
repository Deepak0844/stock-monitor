import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { Writable } from "node:stream";
import { startTestDb, type TestDb } from "@stock-monitor/db/test-harness";
import { createMappingRepository, createSupplierRepository } from "@stock-monitor/db";
import { createLogger } from "@stock-monitor/shared";
import type { HostLookup } from "@stock-monitor/supplier-session";
import { buildApp } from "../src/app.js";

let t: TestDb;
let sid: string;
let acme = "";
const dns: Record<string, string[] | Error> = {};
const lookup: HostLookup = async (host) => {
  const answer = dns[host] ?? ["93.184.216.34"];
  if (answer instanceof Error) throw answer;
  return answer;
};
const logger = createLogger({ level: "silent", stream: new Writable({ write: (_c, _e, cb) => cb() }) });
const app = () =>
  buildApp({
    db: t.appDb,
    logger,
    suppliers: { repo: createSupplierRepository(t.appDb), lookup },
    mappings: { mappings: createMappingRepository(t.appDb), suppliers: createSupplierRepository(t.appDb), lookup },
  });

const addVariant = (id: string, sku: string | null) =>
  t.pool.query(
    `insert into shopify_variants (variant_id, product_id, product_title, variant_title, options, sku, inventory_item_id, tracked, inventory_policy)
     values ($1, 'p1', 'Tee', $2, '[]', $3, $4, true, 'DENY')`,
    [id, `Variant ${id}`, sku, `inv-${id}`],
  );

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
  for (const k of Object.keys(dns)) delete dns[k];
  const s = await createSupplierRepository(t.appDb).create({ name: "Acme", websiteUrl: "https://shop.acme.example/", loginUrl: null, checkIntervalMinutes: 60 });
  if (!s.ok) throw new Error("setup");
  acme = s.supplier.id;
  await addVariant("v1", "S1");
  await addVariant("v2", "S2");
});

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
async function call(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: unknown, cookie = true) {
  const res = await app().inject({ method, url, payload: payload as never, cookies: cookie ? { sid } : {} });
  return { status: res.statusCode, body: res.json() as Json };
}
const good = { variantId: "v1", url: "https://shop.acme.example/p/blue" };
const create = async (over: Json = {}) => {
  const r = await call("POST", "/api/mappings", { supplierId: acme, ...good, ...over });
  expect(r.status).toBe(201);
  return r.body.mapping as Json;
};
const events = async (action: string) => (await t.pool.query("select details from audit_events where action = $1", [action])).rows;

describe("every mapping route needs a signed-in owner", () => {
  const routes: [string, string][] = [
    ["GET", "/api/mappings"], ["POST", "/api/mappings"], ["GET", "/api/mappings/x"], ["PATCH", "/api/mappings/x"],
    ["DELETE", "/api/mappings/x"], ["GET", "/api/variants?mapped=false"], ["PATCH", "/api/suppliers/x/permission"],
  ];
  it.each(routes)("%s %s returns 401 without a session", async (method, url) => {
    expect((await call(method as "GET", url, undefined, false)).status).toBe(401);
  });
});

describe("adding a link by hand", () => {
  it("saves it, names the variant and supplier, and writes an audit event", async () => {
    const m = await create({ note: "main page" });
    expect(m).toMatchObject({ variantId: "v1", supplierId: acme, url: "https://shop.acme.example/p/blue", linkStatus: "not_checked", note: "main page" });
    expect((await events("mapping.created"))[0]?.details).toMatchObject({ variantId: "v1", supplierId: acme });
    const list = await call("GET", "/api/mappings");
    expect(list.body.mappings).toMatchObject([{ productTitle: "Tee", supplierName: "Acme", sku: "S1" }]);
  });

  it.each([
    ["http://shop.acme.example/p", "invalid_url", /https/],
    ["https://10.0.0.1/p", "invalid_url", /IP/],
    ["not-a-url", "invalid_url", /https/],
  ])("refuses the address %s with a plain message", async (url, code, message) => {
    const r = await call("POST", "/api/mappings", { supplierId: acme, variantId: "v1", url });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatchObject({ code });
    expect(r.body.error.message).toMatch(message);
  });

  it("refuses a page on another website", async () => {
    const r = await call("POST", "/api/mappings", { supplierId: acme, variantId: "v1", url: "https://other.example/p" });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatchObject({ code: "wrong_site", message: "That address is not on this supplier's website." });
  });

  it("accepts the supplier's own host and a subdomain of it", async () => {
    await create({ url: "https://shop.acme.example/a" });
    await create({ variantId: "v2", url: "https://cdn.shop.acme.example/b" });
  });

  it("refuses an address that resolves to a private network", async () => {
    dns["shop.acme.example"] = ["10.0.0.5"];
    const r = await call("POST", "/api/mappings", { supplierId: acme, ...good });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe("invalid_url");
  });

  it("says plainly when the variant or the supplier does not exist", async () => {
    expect((await call("POST", "/api/mappings", { supplierId: acme, variantId: "nope", url: good.url })).body.error.code).toBe("variant_not_found");
    expect((await call("POST", "/api/mappings", { supplierId: "00000000-0000-4000-8000-000000000000", ...good })).body.error.code).toBe("supplier_not_found");
  });

  it("refuses a second link for the same variant, even to another supplier", async () => {
    await create();
    const other = await createSupplierRepository(t.appDb).create({ name: "Globex", websiteUrl: "https://globex.example/", loginUrl: null, checkIntervalMinutes: 60 });
    if (!other.ok) throw new Error("setup");
    for (const body of [{ supplierId: acme, variantId: "v1", url: "https://shop.acme.example/other" }, { supplierId: other.supplier.id, variantId: "v1", url: "https://globex.example/p" }]) {
      const r = await call("POST", "/api/mappings", body);
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe("already_mapped");
    }
  });

  it("refuses unknown fields and a missing body", async () => {
    expect((await call("POST", "/api/mappings", { supplierId: acme, ...good, linkStatus: "works" })).status).toBe(400);
    expect((await call("POST", "/api/mappings")).status).toBe(400);
  });
});

describe("changing and removing a link", () => {
  it("resets the link history when the address changes, not when the note does", async () => {
    const m = await create();
    await t.pool.query("update mappings set link_status = 'works', worked_title = 'Tee', last_worked_at = now() where id = $1", [m.id]);
    expect((await call("PATCH", `/api/mappings/${m.id}`, { note: "x" })).body.mapping).toMatchObject({ linkStatus: "works", workedTitle: "Tee" });
    const changed = await call("PATCH", `/api/mappings/${m.id}`, { url: "https://shop.acme.example/p/new" });
    expect(changed.body.mapping).toMatchObject({ url: "https://shop.acme.example/p/new", linkStatus: "not_checked", workedTitle: null });
    expect((await events("mapping.updated"))[1]?.details).toMatchObject({ changed: ["url"] });
  });

  it("holds the same rules on an edit: another site is refused", async () => {
    const m = await create();
    const r = await call("PATCH", `/api/mappings/${m.id}`, { url: "https://other.example/p" });
    expect(r.body.error.code).toBe("wrong_site");
  });

  it("can switch a link off and on", async () => {
    const m = await create();
    expect((await call("PATCH", `/api/mappings/${m.id}`, { enabled: false })).body.mapping.enabled).toBe(false);
  });

  it("deletes a link, and a missing one is a plain 404", async () => {
    const m = await create();
    expect((await call("DELETE", `/api/mappings/${m.id}`)).status).toBe(200);
    expect((await events("mapping.deleted")).length).toBe(1);
    expect((await call("DELETE", `/api/mappings/${m.id}`)).body.error.code).toBe("mapping_not_found");
    expect((await call("GET", "/api/mappings/not-an-id")).status).toBe(404);
  });
});

describe("unmapped variants", () => {
  it("counts and lists variants with no link", async () => {
    await create();
    const r = await call("GET", "/api/variants?mapped=false");
    expect(r.body).toMatchObject({ total: 2, unmapped: 1, items: [{ variantId: "v2" }] });
    expect((await call("GET", "/api/variants?mapped=false&search=zzz")).body.items).toEqual([]);
  });
  it("only answers for mapped=false", async () => {
    expect((await call("GET", "/api/variants")).status).toBe(400);
  });
});

describe("recording permission on a supplier", () => {
  it("stores the status, the note and the date, and audits it", async () => {
    const r = await call("PATCH", `/api/suppliers/${acme}/permission`, { status: "granted", note: "Emailed 10 Nov" });
    expect(r.status).toBe(200);
    expect(r.body.supplier).toMatchObject({ automationPermission: "granted", permissionNote: "Emailed 10 Nov" });
    expect(r.body.supplier.permissionSetAt).toEqual(expect.any(String));
    expect((await events("supplier.permission_set"))[0]?.details).toMatchObject({ status: "granted" });
  });
  it("can change the pause between pages", async () => {
    const r = await call("PATCH", `/api/suppliers/${acme}/permission`, { status: "granted", pauseSeconds: 15 });
    expect(r.body.supplier.checkPauseSeconds).toBe(15);
  });
  it("refuses an unknown status, a bad pause and an unknown supplier", async () => {
    expect((await call("PATCH", `/api/suppliers/${acme}/permission`, { status: "maybe" })).status).toBe(400);
    expect((await call("PATCH", `/api/suppliers/${acme}/permission`, { status: "granted", pauseSeconds: 0 })).status).toBe(400);
    expect((await call("PATCH", "/api/suppliers/00000000-0000-4000-8000-000000000000/permission", { status: "granted" })).status).toBe(404);
  });
});
