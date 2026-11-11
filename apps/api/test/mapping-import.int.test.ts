import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { Writable } from "node:stream";
import { startTestDb, type TestDb } from "@stock-monitor/db/test-harness";
import { createImportPreviewRepository, createMappingRepository, createSupplierRepository } from "@stock-monitor/db";
import { createLogger } from "@stock-monitor/shared";
import { buildApp } from "../src/app.js";

let t: TestDb;
let sid: string;
const logger = createLogger({ level: "silent", stream: new Writable({ write: (_c, _e, cb) => cb() }) });
const app = () =>
  buildApp({
    db: t.appDb,
    logger,
    mappings: { mappings: createMappingRepository(t.appDb), suppliers: createSupplierRepository(t.appDb), previews: createImportPreviewRepository(t.appDb) },
  });

const addVariant = (id: string, sku: string | null, removed = false) =>
  t.pool.query(
    `insert into shopify_variants (variant_id, product_id, product_title, variant_title, options, sku, inventory_item_id, tracked, inventory_policy, removed_at)
     values ($1, 'p1', 'Tee', $2, '[]', $3, $4, true, 'DENY', ${removed ? "now()" : "null"})`,
    [id, `Variant ${id}`, sku, `inv-${id}`],
  );

const DESCRIPTION = '"<p>Soft, comfy tee.\nSecond line with ""quotes"" and, commas</p>"';
const HEADER = "Handle,Title,Body (HTML),Variant SKU,Image Src,Product metafield (supplier_name),Conversation starters";
const csv = (...lines: string[]) => [HEADER, ...lines].join("\r\n") + "\r\n";
const FILE = csv(
  `tee,Tee,${DESCRIPTION},S1,https://cdn.test/a.jpg,Acme,"[""https://shop.acme.example/p/1?_pos=3&_psq=x&variant=77""]"`,
  `tee,,,S2,,,`, // later variant of the same product: values carried down
  `tee,,,,https://cdn.test/b.jpg,,`, // image row, no SKU
  `mug,Mug,,S3,,Other Supplier,"[""https://other.example/m""]"`, // another supplier
  `cap,Cap,,NOPE,,Acme,"[""https://shop.acme.example/cap""]"`, // SKU matches no variant
  `hat,Hat,,S4,,Acme,"[""https://elsewhere.example/hat""]"`, // another website
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
  await t.pool.query("truncate suppliers, shopify_variants, import_previews, audit_events cascade");
  const s = await createSupplierRepository(t.appDb).create({ name: "Acme", websiteUrl: "https://shop.acme.example/", loginUrl: null, checkIntervalMinutes: 60 });
  if (!s.ok) throw new Error("setup");
  for (const [id, sku] of [["v1", "S1"], ["v2", "S2"], ["v3", "S3"], ["v4", "S4"]] as const) await addVariant(id, sku);
  await addVariant("old", "OLD", true);
});

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
async function post(url: string, text: string, cookie = true) {
  const res = await app().inject({ method: "POST", url, payload: text, headers: { "content-type": "text/csv" }, cookies: cookie ? { sid } : {} });
  return { status: res.statusCode, body: res.json() as Json };
}
async function confirm(id: string) {
  const res = await app().inject({ method: "POST", url: `/api/mappings/import/${id}/confirm`, cookies: { sid } });
  return { status: res.statusCode, body: res.json() as Json };
}
const COLUMNS = "handle=0&sku=3&supplier=5&address=6";
const preview = (text = FILE, query = COLUMNS) => post(`/api/mappings/import/preview?${query}`, text);
const linkCount = async () => Number((await t.pool.query("select count(*) from mappings")).rows[0].count);

describe("every import route needs a signed-in owner", () => {
  it.each(["/api/mappings/import/columns", `/api/mappings/import/preview?${COLUMNS}`])("%s returns 401", async (url) => {
    expect((await post(url, FILE, false)).status).toBe(401);
  });
  it("confirm returns 401", async () => {
    const res = await app().inject({ method: "POST", url: "/api/mappings/import/x/confirm" });
    expect(res.statusCode).toBe(401);
  });
});

describe("check the columns", () => {
  it("shows the columns found and suggests the right ones", async () => {
    const r = await post("/api/mappings/import/columns", FILE);
    expect(r.status).toBe(200);
    expect(r.body.header).toHaveLength(7);
    expect(r.body.suggested).toEqual({ handle: 0, sku: 3, supplier: 5, address: 6 });
    expect(r.body.rowCount).toBe(6);
  });
  it("refuses a file that is not a CSV export with a plain message", async () => {
    expect((await post("/api/mappings/import/columns", '"never closed')).body.error.message).toMatch(/quote/);
  });
});

describe("preview", () => {
  it("reads past descriptions, carries values down, and sorts rows into good, skipped and problems", async () => {
    const r = await preview();
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ goodCount: 2, skippedSuppliers: 1, counts: { new: 2, replace: 0, unchanged: 0 } });
    expect(r.body.sample.map((g: Json) => [g.sku, g.url])).toEqual([
      ["S1", "https://shop.acme.example/p/1?variant=77"],
      ["S2", "https://shop.acme.example/p/1?variant=77"],
    ]);
    expect(r.body.problems.map((p: Json) => p.message).sort()).toEqual(["SKU NOPE matches no variant.", "That address is not on this supplier's website."]);
    expect(r.body.warnings).toHaveLength(1); // S1 and S2 share one page
    expect(await linkCount()).toBe(0); // nothing is saved by a preview
  });

  it("leaves out rows for variants whose supplier and address come from Shopify, and says how many", async () => {
    await t.pool.query("update shopify_variants set supplier_name = 'Acme', supplier_url = 'https://shop.acme.example/p/1' where variant_id = 'v1'");
    const r = await preview();
    expect(r.body).toMatchObject({ goodCount: 1, skippedShopify: 1, skippedSuppliers: 1 });
    expect(r.body.sample.map((g: Json) => g.sku)).toEqual(["S2"]);
  });

  it("never stores descriptions or other unused columns", async () => {
    await preview();
    const stored = JSON.stringify((await t.pool.query("select rows from import_previews")).rows);
    expect(stored).not.toContain("comfy");
    expect(stored).not.toContain("cdn.test");
  });

  it("refuses column numbers that are not in the file", async () => {
    for (const query of ["handle=0&sku=3&supplier=5&address=99", "handle=0&sku=3&supplier=5", "handle=x&sku=3&supplier=5&address=6"]) {
      expect((await preview(FILE, query)).status).toBe(400);
    }
  });

  it("refuses a file over 10 MB", async () => {
    const r = await post(`/api/mappings/import/preview?${COLUMNS}`, csv(`tee,Tee,${"x".repeat(10.5 * 1024 * 1024)},S1,,Acme,`));
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/too big/);
  });

  it("stores a formula-looking cell only as a plain address", async () => {
    const r = await preview(csv('tee,Tee,,S1,,Acme,"=HYPERLINK(""https://shop.acme.example/p/9"")"'));
    expect(r.body.sample[0].url).toBe("https://shop.acme.example/p/9");
  });

  it("reports a SKU that appears twice in the file", async () => {
    const r = await preview(csv(`a,A,,S1,,Acme,https://shop.acme.example/1`, `b,B,,S1,,Acme,https://shop.acme.example/2`));
    expect(r.body.problems).toEqual([expect.objectContaining({ line: 3, message: "The same SKU appears twice in the file." })]);
  });
});

describe("confirm", () => {
  it("saves exactly the previewed good rows and audits the counts", async () => {
    const p = await preview();
    const c = await confirm(p.body.previewId);
    expect(c.status).toBe(200);
    expect(c.body).toMatchObject({ created: 2, updated: 0, unchanged: 0 });
    const rows = (await t.pool.query("select variant_id, url from mappings order by variant_id")).rows;
    expect(rows).toEqual([
      { variant_id: "v1", url: "https://shop.acme.example/p/1?variant=77" },
      { variant_id: "v2", url: "https://shop.acme.example/p/1?variant=77" },
    ]);
    const audit = (await t.pool.query("select details from audit_events where action = 'mapping.imported'")).rows;
    expect(audit[0].details).toMatchObject({ created: 2 });
  });

  it("leaves one link per variant when the same file is imported again", async () => {
    await confirm((await preview()).body.previewId);
    const again = await preview();
    expect(again.body.counts).toEqual({ new: 0, replace: 0, unchanged: 2 });
    expect((await confirm(again.body.previewId)).body).toMatchObject({ created: 0, updated: 0, unchanged: 2 });
    expect(await linkCount()).toBe(2);
  });

  it("can only be confirmed once, and an unknown preview is a plain 404", async () => {
    const p = await preview();
    await confirm(p.body.previewId);
    const second = await confirm(p.body.previewId);
    expect(second.status).toBe(404);
    expect(second.body.error.code).toBe("preview_not_found");
    expect((await confirm("not-an-id")).status).toBe(404);
  });

  it("does not link a variant that another supplier took since the preview", async () => {
    const p = await preview();
    const other = await createSupplierRepository(t.appDb).create({ name: "Globex", websiteUrl: "https://globex.example/", loginUrl: null, checkIntervalMinutes: 60 });
    if (!other.ok) throw new Error("setup");
    await t.pool.query("insert into mappings (variant_id, supplier_id, url) values ('v1', $1, 'https://globex.example/x')", [other.supplier.id]);
    const c = await confirm(p.body.previewId);
    expect(c.body).toMatchObject({ created: 1, skipped: 1 });
    expect(await linkCount()).toBe(2);
  });
});
