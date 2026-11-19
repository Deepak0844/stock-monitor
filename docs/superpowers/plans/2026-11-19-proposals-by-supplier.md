# Proposals by supplier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Supplier" picker on the Proposals page that filters both the Waiting and History tabs, with waiting counts per supplier.

**Architecture:** The proposal repository's paged queries take an optional supplier id; `GET /api/proposals` passes `supplierId` through; `GET /api/proposals/count` also returns open counts per supplier. The web page keeps the choice in `?supplier=` via `useListParams`, like Mappings.

**Tech Stack:** Drizzle + PostgreSQL (Testcontainers in tests), Fastify + zod, React + Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-19-proposals-by-supplier-design.md`

## Global Constraints

- Picker: `Select` from `@/components/ui/input.js`, `aria-label="Supplier"`, first option `All suppliers` (value `""`), same as `MappingsPage.tsx:423-430`.
- Waiting option text: `<name> (<n>)`, `(0)` included. History option text: `<name>` only.
- Empty states: `Nothing is waiting for <name>.` and `No past suggestions for <name> yet.`
- Side-menu count (`count()`, `{ open }`) stays the all-supplier total.
- `supplierId` query param: `z.string().uuid().optional()`; a non-UUID is a plain 400 (as Mappings); a UUID with no rows gives an empty list.
- No Claude attribution in commits.

## Review Focus

- Supplier changed while on page 3: list must go back to page 1 (else an empty page with total > 0 shows a skeleton forever). Test in Task 3.
- Switching tabs keeps the supplier (`?supplier=` survives `set({ tab })`). Test in Task 3.
- An approved (state `approved`) suggestion still shows under its supplier in Waiting but is not in the count (count = state `open`, same as the side menu). Test in Task 1.
- Old `GET /api/proposals` with no `page` (lists every open one) stays unchanged. Covered by the existing test at `apps/api/test/proposals.int.test.ts:120-127`.
- Supplier list fails to load: picker shows only "All suppliers" and the page still works. Test in Task 3.

---

### Task 1: Repository filters by supplier and counts per supplier

**Files:**
- Modify: `packages/db/src/proposal-repository.ts:153-173` (`openPage`, `historyTotal`, `history`)
- Test: `packages/db/test/proposal-repository.int.test.ts`

**Interfaces:**
- Produces:
  - `openPage(limit: number, offset: number, supplierId?: string): Promise<{ items: ProposalView[]; total: number }>`
  - `history(limit: number, offset: number, supplierId?: string): Promise<ProposalView[]>`
  - `historyTotal(supplierId?: string): Promise<number>`
  - `openCountBySupplier(): Promise<Record<string, number>>` — state `open` only, keyed by supplier id, suppliers with none absent.

- [ ] **Step 1: Write the failing tests** (new `describe("by supplier")`; create a second supplier "Bolt" with its own variant `v2` and mapping in the test)

```ts
it("pages open and past suggestions of one supplier only", async () => {
  const a = (await repo().evaluateFor(input())).proposal!;          // Acme, v1
  const b = (await repo().evaluateFor(input({ variantId: "v2", mappingId: boltMapping, supplierId: bolt }))).proposal!;
  expect((await repo().openPage(10, 0, bolt)).items.map((p) => p.id)).toEqual([b.id]);
  expect((await repo().openPage(10, 0, bolt)).total).toBe(1);
  expect((await repo().openPage(10, 0)).total).toBe(2);
  await repo().reject(a.id, null, "owner", NOW);
  expect((await repo().history(10, 0, supplier)).map((p) => p.id)).toEqual([a.id]);
  expect(await repo().history(10, 0, bolt)).toEqual([]);
  expect(await repo().historyTotal(supplier)).toBe(1);
  expect(await repo().historyTotal(bolt)).toBe(0);
});

it("counts suggestions waiting for the owner per supplier, not approved ones", async () => {
  expect(await repo().openCountBySupplier()).toEqual({});
  const a = (await repo().evaluateFor(input())).proposal!;
  await repo().evaluateFor(input({ variantId: "v2", mappingId: boltMapping, supplierId: bolt }));
  expect(await repo().openCountBySupplier()).toEqual({ [supplier]: 1, [bolt]: 1 });
  await repo().markApproved(a.id, 0, "owner", NOW);
  expect(await repo().openCountBySupplier()).toEqual({ [bolt]: 1 });
});
```

- [ ] **Step 2: Run, expect FAIL** (`openCountBySupplier is not a function` / wrong ids)

Run: `npx vitest run packages/db/test/proposal-repository.int.test.ts`

- [ ] **Step 3: Implement** — add `supplierId ? eq(proposals.supplierId, supplierId) : undefined` into each `and(...)` where clause (Drizzle drops `undefined`); `openCountBySupplier` is a `select({ supplierId, n: count() }) ... where state = 'open' groupBy supplierId`.

- [ ] **Step 4: Run, expect PASS** (same command, whole file green)

- [ ] **Step 5: Commit** — `feat: proposals can be listed and counted by supplier`

### Task 2: API passes the supplier through and returns counts

**Files:**
- Modify: `apps/api/src/routes/proposals.ts:32-36` (`listQuery`), `:93-111` (list + count routes)
- Test: `apps/api/test/proposals.int.test.ts`

**Interfaces:**
- Consumes: Task 1 signatures.
- Produces: `GET /api/proposals?tab=open|history&page&pageSize&supplierId=<uuid>`; `GET /api/proposals/count` → `{ open: number; bySupplier: Record<string, number> }`.

- [ ] **Step 1: Write the failing tests** — extend `suggest()` with `over.supplierId` (default `acme`); create a second supplier `bolt` in the test.

```ts
it("lists one supplier's suggestions in both tabs", async () => {
  const a = await suggest();
  await suggest({ supplierId: bolt });
  const open = await call("GET", `/api/proposals?tab=open&page=1&pageSize=10&supplierId=${bolt}`);
  expect(open.body.total).toBe(1);
  expect(open.body.proposals[0].supplierName).toBe("Bolt");
  await proposals().reject(a.id, null, "owner", now);
  const past = await call("GET", `/api/proposals?tab=history&supplierId=${acme}`);
  expect(past.body).toMatchObject({ total: 1, hasMore: false });
  expect((await call("GET", `/api/proposals?tab=history&supplierId=${bolt}`)).body.total).toBe(0);
});

it("refuses a supplier id that is not a UUID", async () => {
  expect((await call("GET", "/api/proposals?tab=open&page=1&supplierId=nope")).status).toBe(400);
});

it("counts waiting suggestions per supplier next to the total", async () => {
  await suggest();
  await suggest({ supplierId: bolt });
  await suggest({ supplierId: bolt });
  expect((await call("GET", "/api/proposals/count")).body).toEqual({ open: 3, bySupplier: { [acme]: 1, [bolt]: 2 } });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run apps/api/test/proposals.int.test.ts`
- [ ] **Step 3: Implement** — `listQuery` gains `supplierId: z.string().uuid().optional()`; pass it to `openPage`, `history`, `historyTotal`. The no-`page` branch stays as it is. Count route adds `bySupplier: await proposals.openCountBySupplier()`.
- [ ] **Step 4: Run, expect PASS** (same command)
- [ ] **Step 5: Commit** — `feat: proposals API filters and counts by supplier`

### Task 3: Supplier picker on the Proposals page

**Files:**
- Modify: `apps/web/src/api.ts:469-480` (type), `:746-762` (client)
- Modify: `apps/web/src/test/fake-api.ts:225-236`
- Modify: `apps/web/src/pages/ProposalsPage.tsx` (`History`, `ProposalsPage`)
- Test: `apps/web/src/pages/ProposalsPage.test.tsx`, `apps/web/src/api.test.ts`

**Interfaces:**
- Consumes: Task 2 routes.
- Produces (web):
  - `openPage(query: { page: number; pageSize: number; supplierId?: string })` — adds `supplierId` to the URL only when set.
  - `history(page: number, pageSize?: number, supplierId?: string)`
  - `waitingBySupplier(): Promise<Record<string, number>>` — reads `bySupplier` from `/api/proposals/count`. Fake default `vi.fn().mockResolvedValue({})`.

- [ ] **Step 1: Write the failing tests**

`api.test.ts`: `openPage({ page: 1, pageSize: 10, supplierId: "s1" })` requests a URL containing `supplierId=s1`; without it, no `supplierId` in the URL. `history(1, 10, "s1")` same. `waitingBySupplier()` returns `{ s1: 2 }` from body `{ open: 2, bySupplier: { s1: 2 } }`.

`ProposalsPage.test.tsx` (fake `suppliers.list` → Acme `s1`, Bolt `s2`; `waitingBySupplier` → `{ s1: 2 }`):

```ts
it("filters waiting suggestions by the chosen supplier, with counts", async () => {
  // render; options read "All suppliers", "Acme (2)", "Bolt (0)"
  // choose "Bolt (0)": openPage last called with { page: 1, pageSize: 10, supplierId: "s2" }
  // openPage returns empty: shows "Nothing is waiting for Bolt."
});
it("goes back to page 1 when the supplier changes", async () => { /* start at ?page=3, choose Acme: openPage called with page: 1 */ });
it("keeps the supplier when switching to History, with names only", async () => {
  // choose Acme, press History: history called with (1, 10, "s1"); options read "All suppliers", "Acme", "Bolt"
  // history returns empty: "No past suggestions for Acme yet."
});
it("still lists everything when suppliers cannot be read", async () => { /* suppliers.list rejects: only "All suppliers", cards still render */ });
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run apps/web/src/pages/ProposalsPage.test.tsx apps/web/src/api.test.ts`
- [ ] **Step 3: Implement** — In `ProposalsPage`: `const supplierId = params.filters.supplier ?? ""`; load `api.suppliers.list()` once and `api.proposals.waitingBySupplier()` with each Waiting read (errors ignored); one `Select` above the tab switch; on change `set({ supplier: value || undefined, page: 1 })` (check `useListParams.set` resets page on filter change already; if so, drop `page: 1`). Pass `supplierId || undefined` into `openPage` and into `History` (`history(page, pageSize, supplierId)`). Empty-state titles use the chosen supplier's name when one is chosen.
- [ ] **Step 4: Run, expect PASS** (same command)
- [ ] **Step 5: Full check** — `npm run check`; expect typecheck, lint, unit and integration all green.
- [ ] **Step 6: Commit** — `feat: supplier picker on the Proposals page`
