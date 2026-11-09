import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestDb, type TestDb } from "./harness.js";
import { createCaptureRepository } from "../src/capture-repository.js";
import { createMappingRepository } from "../src/mapping-repository.js";
import { createNotificationRepository } from "../src/notification-repository.js";
import { createObservationRepository } from "../src/observation-repository.js";
import { createRecipeRepository } from "../src/recipe-repository.js";
import { createSupplierRepository } from "../src/supplier-repository.js";

let t: TestDb;
const recipes = () => createRecipeRepository(t.appDb);
const captures = () => createCaptureRepository(t.appDb);
const observations = () => createObservationRepository(t.appDb);
const maps = () => createMappingRepository(t.appDb);
const suppliers = () => createSupplierRepository(t.appDb);
let acme = "";
let globex = "";
let link = "";

const recipe = (word = "Blue Tee") => ({ pageChecks: [{ type: "text", text: word }], inStock: [], outOfStock: [] });
const description = { url: "https://shop.example/p", title: "T", status: 200, pageClass: "ok", sections: [], buttons: [] };
const PRIVATE_PICTURE = Buffer.from("PNG-bytes");
const row = (over: Partial<Parameters<ReturnType<typeof createObservationRepository>["append"]>[0]> = {}) => ({
  mappingId: link, answer: "in_stock" as const, reason: null, quantity: 5, matchedText: "Add to cart", quantityMismatch: false, recipeVersion: 1, checkResult: "ok", captureId: null, ...over,
});

beforeAll(async () => {
  t = await startTestDb();
}, 180_000);
afterAll(async () => {
  await t?.stop();
});
beforeEach(async () => {
  await t.pool.query("truncate suppliers, shopify_variants cascade");
  const a = await suppliers().create({ name: "Acme", websiteUrl: "https://acme.example/", loginUrl: null, checkIntervalMinutes: 60 });
  const g = await suppliers().create({ name: "Globex", websiteUrl: "https://globex.example/", loginUrl: null, checkIntervalMinutes: 60 });
  if (!a.ok || !g.ok) throw new Error("setup");
  acme = a.supplier.id;
  globex = g.supplier.id;
  await t.pool.query(
    `insert into shopify_variants (variant_id, product_id, product_title, variant_title, options, sku, inventory_item_id, tracked, inventory_policy)
     values ('v1', 'p1', 'Tee', 'L', '[]', 'S1', 'i1', true, 'DENY')`,
  );
  const m = await maps().create({ variantId: "v1", supplierId: acme, url: "https://acme.example/p", note: null });
  if (!m.ok) throw new Error("setup");
  link = m.mapping.id;
});

describe("recipes", () => {
  it("never edits a recipe: each save is the next version", async () => {
    expect((await recipes().create(acme, recipe("a"))).version).toBe(1);
    expect((await recipes().create(acme, recipe("b"))).version).toBe(2);
    expect((await recipes().create(globex, recipe("c"))).version).toBe(1);
    expect((await recipes().list(acme)).map((r) => r.version)).toEqual([2, 1]);
  });

  it("starts off, and turning one on turns the previous one off, atomically", async () => {
    const one = await recipes().create(acme, recipe("a"));
    const two = await recipes().create(acme, recipe("b"));
    expect(await recipes().active(acme)).toBeNull();
    await recipes().activate(one.id);
    expect((await recipes().active(acme))?.id).toBe(one.id);
    await recipes().activate(two.id);
    expect((await recipes().active(acme))?.id).toBe(two.id);
    expect((await recipes().list(acme)).filter((r) => r.active)).toHaveLength(1);
  });

  it("the database refuses a second active version for one supplier", async () => {
    const one = await recipes().create(acme, recipe("a"));
    const two = await recipes().create(acme, recipe("b"));
    await t.pool.query("update stock_recipes set active = true where id = $1", [one.id]);
    await expect(t.pool.query("update stock_recipes set active = true where id = $1", [two.id])).rejects.toThrow();
  });

  it("gives the rules back as they were saved", async () => {
    const r = await recipes().create(acme, recipe("a"));
    expect((await recipes().get(r.id))?.rules).toEqual(recipe("a"));
  });

  it("deleting a supplier removes its recipes", async () => {
    await recipes().create(acme, recipe("a"));
    await suppliers().remove(acme);
    expect(await recipes().list(acme)).toEqual([]);
  });
});

describe("captures", () => {
  const ready = async (name = "", labelled: "in_stock" | null = null) => {
    const c = await captures().create({ supplierId: acme, mappingId: link, name });
    await captures().fill(c.id, { status: "ready", pageClass: "ok", description, picture: PRIVATE_PICTURE });
    if (labelled) await captures().label(c.id, { expected: labelled });
    return c.id;
  };
  const age = (id: string, days: number) => t.pool.query("update page_captures set created_at = now() - make_interval(days => $2) where id = $1", [id, days]);
  const count = async () => Number((await t.pool.query("select count(*) from page_captures")).rows[0].count);

  it("starts pending, then holds the description and picture once filled", async () => {
    const c = await captures().create({ supplierId: acme, mappingId: link, name: "Blue Tee" });
    expect(await captures().get(c.id)).toMatchObject({ status: "pending", name: "Blue Tee", expectedAnswer: null, hasPicture: false });
    await captures().fill(c.id, { status: "ready", pageClass: "ok", description, picture: PRIVATE_PICTURE });
    expect(await captures().get(c.id)).toMatchObject({ status: "ready", hasPicture: true, description });
    expect((await captures().picture(c.id))?.equals(PRIVATE_PICTURE)).toBe(true);
  });

  it("can fail with a fixed reason, never a message", async () => {
    const c = await captures().create({ supplierId: acme, mappingId: link, name: "" });
    await captures().fill(c.id, { status: "failed", failureReason: "browser_unavailable" });
    expect(await captures().get(c.id)).toMatchObject({ status: "failed", failureReason: "browser_unavailable", description: null });
  });

  it("lists a supplier's captures without their pictures or text, and labels and removes them", async () => {
    const id = await ready("a");
    expect((await captures().list(acme))[0]).toMatchObject({ id, name: "a", hasPicture: true });
    expect(Object.keys((await captures().list(acme))[0] as object)).not.toContain("picture");
    await captures().label(id, { name: "Blue Tee in stock", expected: "in_stock" });
    expect(await captures().get(id)).toMatchObject({ name: "Blue Tee in stock", expectedAnswer: "in_stock" });
    expect(await captures().remove(id)).toBe(true);
    expect(await captures().get(id)).toBeNull();
  });

  it("gives the labelled, ready captures as examples for testing a recipe", async () => {
    const id = await ready("x", "in_stock");
    await ready("unlabelled");
    expect(await captures().examples(acme)).toMatchObject([{ id, expectedAnswer: "in_stock", mappingId: link, description }]);
  });

  it("keeps at most 50 captures per supplier, removing the oldest unlabelled first", async () => {
    const keep = await ready("labelled", "in_stock");
    await age(keep, 400);
    const oldest = await ready("oldest");
    await age(oldest, 300);
    for (let n = 0; n < 49; n++) await ready(`n${n}`);
    expect(await count()).toBe(50);
    expect(await captures().get(oldest)).toBeNull(); // the 51st pushed out the oldest unlabelled one
    expect(await captures().get(keep)).not.toBeNull(); // a labelled example is never pushed out
  });

  it("keeps the latest three page-changed captures for a link", async () => {
    for (let n = 0; n < 5; n++) await captures().keepChanged(link, { supplierId: acme, pageClass: "ok", description, picture: PRIVATE_PICTURE });
    const rows = (await captures().list(acme)).filter((c) => c.keptReason === "page_changed");
    expect(rows).toHaveLength(3);
  });

  it("deletes unlabelled and page-changed captures older than 30 days, and nothing labelled", async () => {
    const old = await ready("old");
    const oldLabelled = await ready("old labelled", "in_stock");
    const fresh = await ready("fresh");
    await captures().keepChanged(link, { supplierId: acme, pageClass: "ok", description, picture: null });
    const changed = (await captures().list(acme)).find((c) => c.keptReason === "page_changed")!;
    for (const id of [old, oldLabelled, changed.id]) await age(id, 31);
    await captures().purge(30);
    expect(await captures().get(old)).toBeNull();
    expect(await captures().get(changed.id)).toBeNull();
    expect(await captures().get(oldLabelled)).not.toBeNull();
    expect(await captures().get(fresh)).not.toBeNull();
  });

  it("deleting a supplier removes its captures, and deleting a link keeps the capture", async () => {
    const id = await ready("a");
    await maps().remove(link);
    expect((await captures().get(id))?.mappingId).toBeNull();
    await suppliers().remove(acme);
    expect(await captures().get(id)).toBeNull();
  });
});

describe("observations", () => {
  it("appends, and lists a link's history newest first", async () => {
    await observations().append(row({ answer: "out_of_stock", quantity: 0 }));
    await observations().append(row());
    const list = await observations().listFor(link);
    expect(list.map((o) => o.answer)).toEqual(["in_stock", "out_of_stock"]);
    expect(list[0]).toMatchObject({ quantity: 5, matchedText: "Add to cart", recipeVersion: 1, checkResult: "ok" });
  });

  it("gives the latest observation of each link", async () => {
    await observations().append(row({ answer: "out_of_stock", quantity: 0 }));
    await observations().append(row());
    expect((await observations().latestByMapping()).get(link)).toMatchObject({ answer: "in_stock" });
  });

  it("is append only for the app role: no update and no delete", async () => {
    await observations().append(row());
    await expect(t.appPool.query("update stock_observations set answer = 'out_of_stock'")).rejects.toThrow(/permission denied/);
    await expect(t.appPool.query("delete from stock_observations")).rejects.toThrow(/permission denied/);
  });

  it("goes away with its link and with its supplier", async () => {
    await observations().append(row());
    await maps().remove(link);
    expect(Number((await t.pool.query("select count(*) from stock_observations")).rows[0].count)).toBe(0);
  });

  it("rejects an answer that is not one of the three", async () => {
    await expect(t.pool.query("insert into stock_observations (mapping_id, answer, check_result) values ($1, 'maybe', 'ok')", [link])).rejects.toThrow();
  });
});

describe("regions", () => {
  it("a supplier and a link start with no region and can have one", async () => {
    expect(await suppliers().get(acme)).toMatchObject({ defaultRegion: null });
    await suppliers().setRegion(acme, "Loughborough");
    expect(await suppliers().get(acme)).toMatchObject({ defaultRegion: "Loughborough" });
    await suppliers().setRegion(acme, null);
    expect(await suppliers().get(acme)).toMatchObject({ defaultRegion: null });
    expect(await maps().get(link)).toMatchObject({ region: null });
    await maps().update(link, { region: "Hull" });
    expect(await maps().get(link)).toMatchObject({ region: "Hull" });
  });
});

describe("notifications", () => {
  it("can raise the new kind and reason, and old rows still load", async () => {
    const notes = createNotificationRepository(t.appDb);
    await notes.raise({ kind: "supplier_needs_reconnect", supplierId: acme, message: "log in", reason: "login_required" });
    await notes.raise({ kind: "recipe_needs_review", supplierId: acme, message: "Acme's pages changed.", reason: "page_changed" });
    const open = await notes.listOpen();
    expect(open.map((n) => n.kind).sort()).toEqual(["recipe_needs_review", "supplier_needs_reconnect"]);
  });
});
