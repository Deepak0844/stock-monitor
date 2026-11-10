import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestDb, type TestDb } from "./harness.js";
import { createProposalRepository, type EvaluateInput } from "../src/proposal-repository.js";
import { createMappingRepository } from "../src/mapping-repository.js";
import { createSupplierRepository } from "../src/supplier-repository.js";

let t: TestDb;
const repo = () => createProposalRepository(t.appDb);
let supplier = "";
let mapping = "";
const NOW = new Date("2026-06-10T10:00:00Z");
const LATER = new Date("2026-06-11T10:00:00Z");

const input = (over: Partial<EvaluateInput> = {}): EvaluateInput => ({
  variantId: "v1",
  mappingId: mapping,
  supplierId: supplier,
  observationId: null,
  shopifyQuantitySeen: 4,
  wanted: { kind: "set_zero_out_of_stock", proposedQuantity: 0 },
  expiresAt: LATER,
  ...over,
});

beforeAll(async () => {
  t = await startTestDb();
}, 180_000);
afterAll(async () => {
  await t?.stop();
});
beforeEach(async () => {
  await t.pool.query("truncate suppliers, shopify_variants, app_settings cascade");
  const s = await createSupplierRepository(t.appDb).create({ name: "Acme", websiteUrl: "https://acme.example/", loginUrl: null, checkIntervalMinutes: 60 });
  if (!s.ok) throw new Error("setup");
  supplier = s.supplier.id;
  await t.pool.query(
    `insert into shopify_variants (variant_id, product_id, product_title, variant_title, options, sku, inventory_item_id, tracked, inventory_policy)
     values ('v1', 'p1', 'Tee', 'Large', '[]', 'S1', 'inv-v1', true, 'DENY')`,
  );
  const m = await createMappingRepository(t.appDb).create({ variantId: "v1", supplierId: supplier, url: "https://acme.example/a", note: null });
  if (!m.ok) throw new Error("setup");
  mapping = m.mapping.id;
});

describe("evaluateFor", () => {
  it("creates an open suggestion", async () => {
    const r = await repo().evaluateFor(input());
    expect(r).toMatchObject({ change: "created", proposal: { state: "open", kind: "set_zero_out_of_stock", proposedQuantity: 0, shopifyQuantitySeen: 4 } });
  });

  it("keeps the open one when the answer is the same", async () => {
    const a = await repo().evaluateFor(input());
    const b = await repo().evaluateFor(input());
    expect(b.change).toBe("kept");
    expect(b.proposal?.id).toBe(a.proposal?.id);
  });

  it("replaces it when the answer or the Shopify number changed, and keeps the old one as Replaced", async () => {
    const a = await repo().evaluateFor(input());
    const b = await repo().evaluateFor(input({ shopifyQuantitySeen: 3 }));
    expect(b.change).toBe("replaced");
    expect(b.proposal?.id).not.toBe(a.proposal?.id);
    expect(await repo().get(a.proposal!.id)).toMatchObject({ state: "replaced" });
    expect((await repo().open()).map((p) => p.id)).toEqual([b.proposal!.id]);
  });

  it("closes the open one with a reason when nothing is wanted any more", async () => {
    const a = await repo().evaluateFor(input());
    const b = await repo().evaluateFor(input({ wanted: null, closeReason: "could_not_tell" }));
    expect(b).toEqual({ change: "closed", proposal: null });
    expect(await repo().get(a.proposal!.id)).toMatchObject({ state: "replaced", closedReason: "could_not_tell" });
    expect(await repo().open()).toEqual([]);
  });

  it("does nothing when nothing is wanted and nothing is open", async () => {
    expect(await repo().evaluateFor(input({ wanted: null }))).toEqual({ change: "none", proposal: null });
  });

  it("does not suggest again from an observation that already had a suggestion decided, expired or closed", async () => {
    const obs = (await t.pool.query(`insert into stock_observations (mapping_id, answer, check_result) values ($1, 'out_of_stock', 'ok') returning id`, [mapping])).rows[0].id as number;
    const a = (await repo().evaluateFor(input({ observationId: obs }))).proposal!;
    await repo().reject(a.id, null, "owner", NOW);
    expect(await repo().evaluateFor(input({ observationId: obs }))).toEqual({ change: "none", proposal: null });
    expect(await repo().open()).toEqual([]);
    // a newer check is a new observation, so it may suggest again
    const newer = (await t.pool.query(`insert into stock_observations (mapping_id, answer, check_result) values ($1, 'out_of_stock', 'ok') returning id`, [mapping])).rows[0].id as number;
    expect((await repo().evaluateFor(input({ observationId: newer }))).change).toBe("created");
  });

  it("two evaluations at the same moment give one open suggestion", async () => {
    const both = await Promise.all([repo().evaluateFor(input()), repo().evaluateFor(input())]);
    expect(await repo().open()).toHaveLength(1);
    expect(new Set(both.map((r) => r.proposal?.id)).size).toBe(1);
  });

  it("leaves an approved suggestion that is waiting for Shopify alone", async () => {
    const a = await repo().evaluateFor(input());
    await repo().markApproved(a.proposal!.id, 0, "owner", NOW);
    const b = await repo().evaluateFor(input({ shopifyQuantitySeen: 2 }));
    expect(b.change).toBe("kept");
    expect(await repo().get(a.proposal!.id)).toMatchObject({ state: "approved" });
  });
});

describe("approving", () => {
  it("approves once with a stored key, and a second approve gets nothing", async () => {
    const a = (await repo().evaluateFor(input())).proposal!;
    const first = await repo().markApproved(a.id, 0, "owner", NOW);
    expect(first).toMatchObject({ state: "approved", approvedQuantity: 0, edited: false, decidedBy: "owner" });
    expect(first?.idempotencyKey).toEqual(expect.any(String));
    expect(await repo().markApproved(a.id, 0, "owner", NOW)).toBeNull();
  });

  it("two approvals at the same moment give one winner", async () => {
    const a = (await repo().evaluateFor(input())).proposal!;
    const both = await Promise.all([repo().markApproved(a.id, 0, "owner", NOW), repo().markApproved(a.id, 0, "owner", NOW)]);
    expect(both.filter(Boolean)).toHaveLength(1);
  });

  it("marks an edited number as edited", async () => {
    const a = (await repo().evaluateFor(input())).proposal!;
    expect(await repo().markApproved(a.id, 2, "owner", NOW)).toMatchObject({ approvedQuantity: 2, edited: true });
  });

  it("refuses a rejected, expired, replaced or unknown suggestion", async () => {
    const a = (await repo().evaluateFor(input())).proposal!;
    await repo().reject(a.id, "no", "owner", NOW);
    expect(await repo().markApproved(a.id, 0, "owner", NOW)).toBeNull();

    const b = (await repo().evaluateFor(input())).proposal!;
    expect(await repo().markApproved(b.id, 0, "owner", new Date(LATER.getTime() + 1))).toBeNull();
    expect(await repo().markApproved("11111111-1111-4111-8111-111111111111", 0, "owner", NOW)).toBeNull();
    expect(await repo().markApproved("not-an-id", 0, "owner", NOW)).toBeNull();
  });

  it("refuses a negative number at the database", async () => {
    const a = (await repo().evaluateFor(input())).proposal!;
    await expect(repo().markApproved(a.id, -1, "owner", NOW)).rejects.toThrow();
  });
});

describe("outcomes", () => {
  it("applied, conflict and failed only follow approved, and free the variant for a new suggestion", async () => {
    const a = (await repo().evaluateFor(input())).proposal!;
    expect(await repo().markApplied(a.id, 0, NOW)).toBe(false); // not approved yet
    await repo().markApproved(a.id, 0, "owner", NOW);
    expect(await repo().markApplied(a.id, 0, NOW)).toBe(true);
    expect(await repo().get(a.id)).toMatchObject({ state: "applied", resultQuantity: 0, resultCode: "applied" });
    expect(await repo().markApplied(a.id, 0, NOW)).toBe(false);

    const b = (await repo().evaluateFor(input())).proposal!;
    await repo().markApproved(b.id, 0, "owner", NOW);
    expect(await repo().markConflict(b.id, 7)).toBe(true);
    expect(await repo().get(b.id)).toMatchObject({ state: "conflict", resultCode: "changed", resultQuantity: 7 });

    const c = (await repo().evaluateFor(input())).proposal!;
    await repo().markApproved(c.id, 0, "owner", NOW);
    expect(await repo().markFailed(c.id, "no_permission")).toBe(true);
    expect(await repo().get(c.id)).toMatchObject({ state: "failed", resultCode: "no_permission" });
  });

  it("counts attempts", async () => {
    const a = (await repo().evaluateFor(input())).proposal!;
    expect(await repo().bumpAttempts(a.id)).toBe(1);
    expect(await repo().bumpAttempts(a.id)).toBe(2);
  });
});

describe("reject and expire", () => {
  it("rejects an open suggestion with an optional note, once", async () => {
    const a = (await repo().evaluateFor(input())).proposal!;
    expect(await repo().reject(a.id, null, "owner", NOW)).toBe(true);
    expect(await repo().get(a.id)).toMatchObject({ state: "rejected", note: null, decidedBy: "owner" });
    expect(await repo().reject(a.id, null, "owner", NOW)).toBe(false);
  });

  it("expires only open suggestions that are due", async () => {
    const a = (await repo().evaluateFor(input())).proposal!;
    expect(await repo().expireDue(NOW)).toBe(0);
    expect(await repo().expireDue(LATER)).toBe(1);
    expect(await repo().get(a.id)).toMatchObject({ state: "expired" });
    expect(await repo().open()).toEqual([]);
  });

  it("does not expire an approved suggestion", async () => {
    const a = (await repo().evaluateFor(input())).proposal!;
    await repo().markApproved(a.id, 0, "owner", NOW);
    expect(await repo().expireDue(new Date(LATER.getTime() + 1000))).toBe(0);
  });
});

describe("history", () => {
  it("lists decided and closed suggestions newest first with the product and supplier words", async () => {
    const a = (await repo().evaluateFor(input())).proposal!;
    await repo().reject(a.id, "later", "owner", NOW);
    const rows = await repo().history(10, 0);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: a.id, state: "rejected", productTitle: "Tee", variantTitle: "Large", sku: "S1", supplierName: "Acme", note: "later" });
    expect(await repo().open()).toEqual([]);
  });

  it("open suggestions carry what the screen needs, including Shopify tracking and policy", async () => {
    await repo().evaluateFor(input());
    expect((await repo().open())[0]).toMatchObject({ productTitle: "Tee", sku: "S1", supplierName: "Acme", tracked: true, inventoryPolicy: "DENY" });
  });
});

describe("cleanup", () => {
  it("removing the supplier removes its suggestions", async () => {
    await repo().evaluateFor(input());
    await t.pool.query("delete from suppliers");
    expect((await t.pool.query("select count(*)::int as n from proposals")).rows[0].n).toBe(0);
  });
});

describe("settings", () => {
  it("starts at 5 and 24 hours and saves new values", async () => {
    expect(await repo().settings()).toEqual({ defaultQuantity: 5, expiryHours: 24 });
    await repo().saveSettings({ defaultQuantity: 8, expiryHours: 12 });
    expect(await repo().settings()).toEqual({ defaultQuantity: 8, expiryHours: 12 });
  });
});

describe("no content", () => {
  it("has no column that could hold page text, addresses or secrets", async () => {
    const { rows } = await t.pool.query("select column_name from information_schema.columns where table_name = 'proposals'");
    const names = rows.map((r) => r.column_name as string);
    for (const bad of ["url", "page", "text", "html", "address", "cookie", "secret", "token", "matched_text"]) {
      expect(names.filter((n) => n.includes(bad))).toEqual([]);
    }
  });
});
