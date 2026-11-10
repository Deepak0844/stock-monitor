import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { Writable } from "node:stream";
import { startTestDb, type TestDb } from "@stock-monitor/db/test-harness";
import { createCaptureRepository, createMappingRepository, createRecipeRepository, createSupplierRepository } from "@stock-monitor/db";
import { createLogger } from "@stock-monitor/shared";
import { buildApp } from "../src/app.js";

let t: TestDb;
let sid: string;
let acme = "";
let link = "";
const logger = createLogger({ level: "silent", stream: new Writable({ write: (_c, _e, cb) => cb() }) });
const app = () =>
  buildApp({
    db: t.appDb,
    logger,
    recipes: { recipes: createRecipeRepository(t.appDb), captures: createCaptureRepository(t.appDb), mappings: createMappingRepository(t.appDb), suppliers: createSupplierRepository(t.appDb) },
    mappings: { mappings: createMappingRepository(t.appDb), suppliers: createSupplierRepository(t.appDb) },
  });

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
async function call(method: "GET" | "POST" | "PATCH", url: string, payload?: unknown, cookie = true) {
  const res = await app().inject({ method, url, payload: payload as never, cookies: cookie ? { sid } : {} });
  return { status: res.statusCode, body: res.json() as Json };
}
const captures = () => createCaptureRepository(t.appDb);
const events = async (action: string) => (await t.pool.query("select entity_id, details from audit_events where action = $1", [action])).rows;

const recipe = {
  pageChecks: [{ type: "text", text: "Blue Tee" }],
  inStock: [{ type: "button", label: "Add to cart", enabled: true }],
  outOfStock: [{ type: "text", text: "Sold out" }],
};
const page = (over: Partial<{ lines: string[]; buttons: unknown[]; sections: unknown[] }> = {}) => ({
  url: "https://shop.example/p",
  title: "Blue Tee",
  status: 200,
  pageClass: "ok",
  sections: over.sections ?? [{ heading: "Blue Tee", level: 1, lines: over.lines ?? ["Soft cotton."] }],
  buttons: over.buttons ?? [{ label: "Add to cart", enabled: true, section: "Blue Tee" }],
});
async function example(description: unknown, expected: "in_stock" | "out_of_stock" | "cannot_tell", name = "example") {
  const c = await captures().create({ supplierId: acme, mappingId: link, name });
  await captures().fill(c.id, { status: "ready", pageClass: "ok", description, picture: null });
  await captures().label(c.id, { expected });
  return c.id;
}
const saved = async (r: unknown = recipe) => (await call("POST", `/api/suppliers/${acme}/recipes`, { recipe: r })).body.recipe as { id: string; version: number };

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
  const s = await createSupplierRepository(t.appDb).create({ name: "Acme", websiteUrl: "https://shop.acme.example/", loginUrl: null, checkIntervalMinutes: 60 });
  if (!s.ok) throw new Error("setup");
  acme = s.supplier.id;
  await t.pool.query(
    `insert into shopify_variants (variant_id, product_id, product_title, variant_title, options, sku, inventory_item_id, tracked, inventory_policy)
     values ('v1', 'p1', 'Tee', 'L', '[]', 'S1', 'i1', true, 'DENY')`,
  );
  const m = await createMappingRepository(t.appDb).create({ variantId: "v1", supplierId: acme, url: "https://shop.acme.example/p", note: null });
  if (!m.ok) throw new Error("setup");
  link = m.mapping.id;
});

describe("every recipe route needs a signed-in owner", () => {
  const routes: [string, string][] = [
    ["GET", "/api/suppliers/x/recipes"], ["POST", "/api/suppliers/x/recipes"], ["POST", "/api/suppliers/x/recipes/test"],
    ["POST", "/api/recipes/x/activate"], ["PATCH", "/api/suppliers/x/region"],
  ];
  it.each(routes)("%s %s returns 401 without a session", async (method, url) => {
    expect((await call(method as "GET", url, undefined, false)).status).toBe(401);
  });
});

describe("saving versions", () => {
  it("saves the next version each time, never editing the old one, and audits the version", async () => {
    expect((await saved()).version).toBe(1);
    expect((await saved({ ...recipe, pageChecks: [{ type: "text", text: "Blue Tee Classic" }] })).version).toBe(2);
    const list = (await call("GET", `/api/suppliers/${acme}/recipes`)).body.recipes;
    expect(list.map((r: Json) => [r.version, r.active])).toEqual([[2, false], [1, false]]);
    expect(list[1].rules.pageChecks[0].text).toBe("Blue Tee");
    expect((await events("recipe.saved")).map((e) => e.details.version)).toEqual([1, 2]);
  });

  it("refuses a recipe that is not valid, with the plain message", async () => {
    const r = await call("POST", `/api/suppliers/${acme}/recipes`, { recipe: { ...recipe, pageChecks: [] } });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatchObject({ code: "invalid_recipe" });
    expect(r.body.error.message).toMatch(/page check/i);
    expect((await call("POST", `/api/suppliers/${acme}/recipes`, {})).status).toBe(400);
    expect((await call("POST", "/api/suppliers/00000000-0000-4000-8000-000000000000/recipes", { recipe })).status).toBe(404);
  });
});

describe("testing a draft on the saved examples", () => {
  it("says which examples give the expected answer and which do not, and saves nothing", async () => {
    await example(page(), "in_stock", "in stock page");
    await example(page({ lines: ["Sold out"], buttons: [] }), "out_of_stock", "sold out page");
    await example(page(), "out_of_stock", "wrong label");
    const r = await call("POST", `/api/suppliers/${acme}/recipes/test`, { recipe });
    expect(r.status).toBe(200);
    expect(r.body.results.map((x: Json) => [x.name, x.passed])).toEqual([["in stock page", true], ["sold out page", true], ["wrong label", false]]);
    expect(r.body.results[2].got.answer).toBe("in_stock");
    expect(r.body.passed).toBe(false);
    expect((await call("GET", `/api/suppliers/${acme}/recipes`)).body.recipes).toEqual([]);
  });

  it("is not passing when there are no examples", async () => {
    expect((await call("POST", `/api/suppliers/${acme}/recipes/test`, { recipe })).body).toMatchObject({ results: [], passed: false });
  });

  it("uses the region of each example's link, or the supplier's default", async () => {
    const regional = { pageChecks: [{ type: "text", text: "Blue Tee" }], inStock: [], outOfStock: [], region: { under: "Stores" } };
    const withTable = page({ sections: [{ heading: "Blue Tee", level: 1, lines: [] }, { heading: "Stores", level: 2, lines: ["Hull\t5", "Bristol\t0"] }], buttons: [] });
    await example(withTable, "out_of_stock", "uses the supplier default");
    await createSupplierRepository(t.appDb).setRegion(acme, "Bristol");
    expect((await call("POST", `/api/suppliers/${acme}/recipes/test`, { recipe: regional })).body.passed).toBe(true);
    await createMappingRepository(t.appDb).update(link, { region: "Hull" });
    expect((await call("POST", `/api/suppliers/${acme}/recipes/test`, { recipe: regional })).body.passed).toBe(false); // Hull has 5, so in stock
  });

  it("refuses a recipe that is not valid", async () => {
    expect((await call("POST", `/api/suppliers/${acme}/recipes/test`, { recipe: { nope: 1 } })).body.error.code).toBe("invalid_recipe");
  });
});

describe("turning a version on", () => {
  it("is refused when there are no labelled examples", async () => {
    const r = await call("POST", `/api/recipes/${(await saved()).id}/activate`);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("no_examples");
  });

  it("is refused, naming the examples that fail, when any fails", async () => {
    await example(page(), "in_stock", "good one");
    await example(page(), "out_of_stock", "bad one");
    const r = await call("POST", `/api/recipes/${(await saved()).id}/activate`);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("examples_failed");
    expect(r.body.error.message).toContain("bad one");
    expect(r.body.error.message).not.toContain("good one");
    expect(await createRecipeRepository(t.appDb).active(acme)).toBeNull();
  });

  it("works when every example passes, switches the active version and audits it", async () => {
    await example(page(), "in_stock");
    const one = await saved();
    const two = await saved({ ...recipe, outOfStock: [] });
    expect((await call("POST", `/api/recipes/${one.id}/activate`)).body.recipe).toMatchObject({ version: 1, active: true });
    expect((await call("POST", `/api/recipes/${two.id}/activate`)).body.recipe).toMatchObject({ version: 2, active: true });
    expect((await createRecipeRepository(t.appDb).active(acme))?.id).toBe(two.id);
    expect((await events("recipe.activated")).map((e) => e.details.version)).toEqual([1, 2]);
  });

  it("an unknown or made-up recipe is a plain 404", async () => {
    expect((await call("POST", "/api/recipes/00000000-0000-4000-8000-000000000000/activate")).body.error.code).toBe("recipe_not_found");
    expect((await call("POST", "/api/recipes/not-an-id/activate")).status).toBe(404);
  });
});

describe("regions", () => {
  it("sets and clears a supplier's default region", async () => {
    expect((await call("PATCH", `/api/suppliers/${acme}/region`, { region: "  Loughborough " })).body.supplier.defaultRegion).toBe("Loughborough");
    expect((await call("PATCH", `/api/suppliers/${acme}/region`, { region: null })).body.supplier.defaultRegion).toBeNull();
    expect((await call("PATCH", `/api/suppliers/${acme}/region`, { region: "   " })).body.supplier.defaultRegion).toBeNull();
    expect((await events("supplier.region_set")).length).toBe(3);
  });
  it("refuses a region that is too long or not text, and an unknown supplier", async () => {
    expect((await call("PATCH", `/api/suppliers/${acme}/region`, { region: "x".repeat(201) })).body.error.code).toBe("invalid_region");
    expect((await call("PATCH", `/api/suppliers/${acme}/region`, { region: 5 })).body.error.code).toBe("invalid_region");
    expect((await call("PATCH", "/api/suppliers/00000000-0000-4000-8000-000000000000/region", { region: "A" })).status).toBe(404);
  });
  it("a link can have its own region, set and cleared when adding or editing", async () => {
    const edit = await call("PATCH", `/api/mappings/${link}`, { region: "Hull" });
    expect(edit.body.mapping.region).toBe("Hull");
    expect((await call("PATCH", `/api/mappings/${link}`, { region: null })).body.mapping.region).toBeNull();
    expect((await call("PATCH", `/api/mappings/${link}`, { region: "x".repeat(201) })).body.error.code).toBe("invalid_region");
  });
});
