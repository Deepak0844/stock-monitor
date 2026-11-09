# Implementation Plan: mapping

Spec: `SPEC-mapping.md` (v2, approved 2026-11-10). Map: `CAPABILITY-MAP.md`. Steps use `- [ ]` so progress shows.
Repo is public: no supplier names or domains in code, fixtures or docs. Use the fake supplier. Never touch the owner's `.env`. Use npm. One branch from `develop` and one PR per task, merge on green.

## Overview
Store which supplier page matches each Shopify variant. Import links from the Shopify product export. Check each link on request and say what happened to the link (works, never worked, page missing, moved, looks different, needs login, could not check). Expose an "unavailable candidate" for later `proposals`. No stock is read here.

## Architecture decisions
- **Pure logic in a new `packages/mapping`** (export reader, columns, address cleaning, row checks, link-status rules). No I/O, so every rule is a unit test.
- **Own small CSV parser** (spec: no new dependency without asking). Tested against quoted commas, line breaks, BOM, formula cells.
- **Link checks reuse the browser service.** It gets one new call, `checkPage`, that loads one address with a saved session and returns `{ result: PageClass, status, finalUrl, title, heading }`. Never page text beyond the first heading.
- **The status decision is a pure function** `decideLinkStatus(previous, observation, supplierContext)`. The worker only gathers observations and saves the decision.
- **Pause between pages:** the worker runs one supplier's links sequentially and sleeps `check_pause_seconds` (default 10, at least the supplier's crawl delay, set by the owner) between pages.
- **Permission gate** is checked in the API before queuing and again in the worker.

## Global constraints (from the spec, verbatim values)
- Addresses: https only, no IP, no private network, on the supplier's own host or a subdomain.
- Tracking parts removed from import addresses: `_pos`, `_psq`, `_psid`, `_ss` only. `?variant=` stays.
- CSV limits: 10 MB, 20,000 rows. Cells starting `=`, `+`, `-`, `@` stored as text. Descriptions and unused columns never stored.
- Unavailable candidate: link worked before, **2** page-missing checks at least **6 hours** apart, last run not supplier-wide. Supplier-wide: at least **5** links and at least **30%** missing in one run.
- A redirect to the supplier's home page on a link that worked before is **page missing**. On a link that never worked it is **never worked**. A redirect to a category or search page is **moved**.
- `needs_login` and `could_not_check` never change `missing_checks`, never mark a link broken, never change the supplier's own status.
- Pause between pages: default 10 seconds, never below the supplier's setting.
- No stock figure, cookie, session or page text in any table, job payload, log or audit event. Job payload is only `{ mappingId }` or `{ supplierId }`.

## Review focus (inputs the spec implies; each has a test in the named task)
1. Export with a BOM, CRLF line endings and a description holding commas and line breaks (Task 1).
2. A product whose first row carries the supplier and address and whose later variant rows are blank (Task 1).
3. Same SKU on two variants in Shopify, and the same SKU twice in the file (Task 3).
4. A variant that Shopify later removed while it has a mapping (Task 4).
5. A supplier deleted or paused while its link checks are queued (Task 8).

## Dependency graph
```
1 pure: CSV + export reader ── 2 pure: address cleaning + row checks ── 3 pure: matching + preview
4 db: tables, repos, permission fields ── 5 API: mappings CRUD, unmapped, permission
3+4 ── 6 API: import (columns, preview, confirm)
7 pure: link-status rules ── 8 browser checkPage + worker job + check routes (needs 4, 5, 7)
5,6,8 ── 9 web: Mappings, form, unmapped, supplier permission
6,9 ── 10 web: import screens
8,9 ── 11 dashboard card, e2e journeys, accessibility
```

## Tasks

### Task 1: Shopify export reader (pure)
**Files:** create `packages/mapping/{package.json,tsconfig.json,src/index.ts,src/csv.ts,src/export.ts,src/csv.test.ts,src/export.test.ts}`; register the workspace.
**Interfaces — Produces:**
`parseCsv(text: string, limits?: {maxBytes: number; maxRows: number}): {ok: true; header: string[]; rows: string[][]} | {ok: false; message: string}`
`readExport(header: string[], rows: string[][], cols: Columns): ExportRow[]` with `Columns = {sku: number; supplier: number; address: number; handle: number}` and `ExportRow = {line: number; handle: string; sku: string; supplierName: string; addressCell: string}`. Rows with no `Variant SKU` are dropped. Blank supplier or address cells take the value from the earlier row with the same handle.
- [ ] Failing tests: quoted comma and line break in a cell; BOM; CRLF; over 10 MB and over 20,000 rows refused with plain messages; a cell starting `=`, `+`, `-` or `@` comes back as plain text, unchanged (it is never evaluated or written back out); image-only rows dropped; carry-down for rows with the same `Handle`.
- [ ] Run, see fail. Implement a small state-machine parser. Run, see pass.
- [ ] `npm run check`. Commit `feat(mapping): read the Shopify export`.

### Task 2: Column suggestion, address cleaning, row checks (pure)
**Files:** `packages/mapping/src/{columns,address,rows}.ts` and tests.
**Interfaces — Produces:**
`suggestColumns(header: string[], sample: string[][]): {sku: number | null; supplier: number | null; address: number | null; handle: number | null}` (sku = `Variant SKU`; supplier = header containing `supplier_name`; address = the column whose sample cells are addresses or `["https://…"]` lists).
`cleanAddress(cell: string): {ok: true; url: string} | {ok: false; message: string}` (first address of a list, removes only the four tracking parts, uses `validateSupplierUrl`).
`sameSite(url: string, supplierHost: string): boolean` (same host or a subdomain).
`checkRow(row: ExportRow, ctx: {suppliers: Map<string, SupplierRef>; variantsBySku: Map<string, string[]>}): RowResult` with `RowResult = {kind: 'good'; variantId; supplierId; url} | {kind: 'skipped_supplier'} | {kind: 'problem'; message}`. Messages are the spec's plain wording ("SKU B0361 matches no variant", "matches two variants", "that address is not on this supplier's website", "no address in that row").
- [ ] Failing tests for every message and for `?variant=` kept, tracking parts removed, list form, http refused, other-host refused, subdomain accepted, supplier matched ignoring capitals.
- [ ] Implement, pass, `npm run check`, commit `feat(mapping): column suggestion, address cleaning, row checks`.

### Task 3: Preview builder (pure)
**Files:** `packages/mapping/src/preview.ts`, test.
**Interfaces — Produces:** `buildPreview(rows: ExportRow[], ctx, existing: Map<string, {url: string}>): Preview` with `Preview = {good: GoodRow[]; skippedSuppliers: number; problems: {line: number; sku: string; message: string}[]; counts: {new: number; replace: number; unchanged: number}}`. A SKU appearing twice in the file is a problem on the second row ("the same SKU appears twice in the file"). Duplicate page addresses are warned, not refused.
- [ ] Tests: counts new/replace/unchanged; duplicate SKU; same SKU on two Shopify variants; one address shared by two variants gives a warning only.
- [ ] Implement, pass, commit `feat(mapping): import preview`.

### Task 4: Database tables and repositories
**Files:** modify `packages/db/src/schema.ts` (+ generated `drizzle/0007_*.sql` via `npm run db:generate`); create `packages/db/src/{mapping-repository,import-preview-repository}.ts`; extend `supplier-repository.ts`; export from `index.ts`.
**Interfaces — Produces:** tables `mappings` and `import_previews` as in the spec's data model; `suppliers` gains `automation_permission` (check in `unknown|granted|not_granted`, default `unknown`), `permission_note`, `permission_set_at`, `check_pause_seconds` (default 10, check `>= 1`). `mappings` unique on (`variant_id`,`supplier_id`), `variant_id` references `shopify_variants` (no cascade), `supplier_id` references `suppliers` on delete cascade, `link_status` check on the eight values.
Repository functions: `mappings.list(filter)`, `get`, `create`, `update`, `delete`, `upsertMany(rows)` (idempotent), `unmappedVariants(search)` (excludes removed), `recordCheck(id, decision)`, `forSupplier(supplierId)`; `previews.save(rows): id`, `take(id)`, `purgeOlderThan(1h)`; `suppliers.setPermission(id, {status, note})`.
- [ ] Failing integration tests (real PostgreSQL, existing harness): second mapping for the same variant and supplier refused; deleting a supplier removes its mappings; a removed variant keeps its mapping; `upsertMany` twice gives one row each; `unmappedVariants` excludes removed variants; preview rows expire after an hour.
- [ ] Implement, `npm run db:generate`, migrate in the test harness, pass, commit `feat(db): mappings, import previews, supplier permission`.

### Task 5: Mappings API (by hand, unmapped, permission)
**Files:** `apps/api/src/routes/mappings.ts` and test; modify `suppliers.ts` (permission route) and app wiring.
**Interfaces — Produces:** `GET/POST /api/mappings`, `GET/PATCH/DELETE /api/mappings/:id`, `GET /api/variants?mapped=false&search=`, `PATCH /api/suppliers/:id/permission` body `{status, note?}`. All need the owner. "One per variant" is enforced here with the plain message; address checked by `validateSupplierUrl` + `verifyPublicHost` + `sameSite`. Editing the address resets link history. Every write audited with counts, no page content.
- [ ] Failing tests: needs-auth on every route; bad address, other-site address, missing variant, missing supplier, second mapping for the same variant each give their plain error; edit resets `link_status` to `not_checked`; permission route stores status, note, date and audits it.
- [ ] Implement, pass, commit `feat(api): mappings and supplier permission routes`.

### Task 6: Import API
**Files:** `apps/api/src/routes/mapping-import.ts` and test.
**Interfaces — Consumes:** Tasks 1 to 4. **Produces:** `POST /api/mappings/import/columns` (upload, returns header and suggested columns, nothing stored), `POST /api/mappings/import/preview` (upload + chosen columns, stores rows in `import_previews`, returns `Preview` and `previewId`), `POST /api/mappings/import/:previewId/confirm` (saves exactly the previewed good rows, deletes the preview, audits counts, returns the saved mapping ids). Upload limit 10 MB enforced by the multipart parser. Descriptions and other columns are never read into `import_previews`.
- [ ] Failing tests: confirm saves exactly the previewed rows; importing the same file twice leaves one mapping per variant; a stored preview holds none of the unused columns (assert on the table row); an expired or used `previewId` gives a plain error; oversized upload refused; formula cell stored as text.
- [ ] Implement, pass, commit `feat(api): import mappings from the Shopify export`.

### Task 7: Link-status rules (pure)
**Files:** `packages/mapping/src/link-status.ts`, test.
**Interfaces — Produces:**
`type Observation = {result: PageClass | 'service_unavailable'; status: number | null; finalUrl: string | null; title: string | null; heading: string | null; softNotFound: boolean}`
`type LinkState = {status: LinkStatus; lastWorkedAt: Date | null; workedTitle: string | null; workedHeading: string | null; missingChecks: number; firstMissingAt: Date | null}`
`decideLinkStatus(prev: LinkState, obs: Observation, ctx: {requestedUrl: string; homeUrl: string; now: Date; supplierWide: boolean}): LinkState`
`isHomePage(finalUrl: string, homeUrl: string): boolean`
`isSupplierWide(results: LinkStatus[]): boolean` (≥5 links and ≥30% page missing)
`isUnavailableCandidate(state: LinkState, supplierWide: boolean, now: Date): boolean`
- [ ] Failing tests, one per row of the spec's status table, plus: wrong URL never worked; worked then 404; 410; soft 404 with 200; redirect home on a worked link (page missing); redirect home on a never-worked link (never worked); redirect to category (moved); title changed (looks different); login/captcha/blocked (needs login, counters untouched); unreachable and service down (could not check, counters untouched); two missing checks under 6 h apart (no candidate) and over 6 h apart (candidate); supplier-wide run (no candidate, counters untouched); a good check resets `missing_checks`.
- [ ] Implement, pass, commit `feat(mapping): link-status rules`.

### Task 8: Browser `checkPage`, link-check job, check routes
**Files:** modify `services/browser/src/{server,verify}.ts` and tests, `packages/browser-client/src/client.ts` (+ `/testing` fake), `packages/queue/src/jobs.ts`; create `apps/worker/src/mapping-link-check.ts` and test; modify `apps/api/src/routes/mappings.ts` for `POST /api/mappings/:id/check-link` and `POST /api/suppliers/:id/check-links`.
**Interfaces — Produces:** browser route `POST /check-page {url, state}` → `{result: PageClass, status, finalUrl, title, heading, softNotFound}` through the existing guard proxy. Client `checkPage(request): Promise<CheckPageOutcome>`. Jobs `mapping.link.check {mappingId}` and `mapping.links.check {supplierId}` (the second queues one sequential run honouring `check_pause_seconds`). Refusal messages for: supplier not connected, paused, permission not `granted`.
- [ ] Failing tests: fake-supplier pages for every case in the spec's link-status list (add routes to `createFakeSupplier`: `/gone` 404, `/gone410`, `/soft404` 200 "not found", `/redirect/home`, `/redirect/category`, `/renamed`); worker test that a supplier needing attention is never turned into a broken link and its status is untouched; pause between pages measured with the injected `sleep`; a run where ≥5 links and ≥30% go missing is supplier-wide; a supplier deleted or paused while queued is skipped; permission `unknown` refused in both API and worker; nothing about stock, cookies or sessions in job payloads, logs or audit (scan).
- [ ] Implement, pass, `npm run test:browser`, commit `feat: check mapped links through the browser service`.

### Task 9: Web — Mappings, form, unmapped, supplier permission
**Files:** `apps/web/src/pages/{MappingsPage,MappingFormPage,UnmappedVariantsPage}.tsx` + tests; modify `SupplierFormPage.tsx` or supplier row for the permission record; sidebar entry and routes.
Invoke `ui-ux-pro-max` and `design-taste-frontend` first; match the existing Suppliers screens (components, empty states, light/dark).
- [ ] Failing component tests: table with filters and search and empty state; unmapped count "212 of 340 variants are not mapped" and **Map** buttons; form errors shown beside fields; status shown in words with "Worked until 5 Nov"; permission record saves; link check buttons show the refusal reason in plain words.
- [ ] Implement, pass, commit `feat(web): mappings screens`.

### Task 10: Web — import screens
**Files:** `apps/web/src/pages/ImportMappingsPage.tsx` + test.
- [ ] Failing tests: choose file → suggested columns editable → preview with counts and per-row problems → confirm → summary with **Check these links now**; oversized file message; nothing saved before confirm.
- [ ] Implement, pass, commit `feat(web): import mappings`.

### Task 11: Dashboard card, browser journeys, accessibility
**Files:** modify `DashboardPage.tsx`; create `e2e/mappings.spec.ts` (serial, like `e2e/suppliers.spec.ts`); extend e2e fake supplier/browser stand-in; add `control.resetMappings`.
- [ ] Journeys: import the export (made-up variants, a fixture shaped like Shopify's export with a long description), change a column, preview, confirm, filter unmapped, check links and see each status, record permission, plus the no-secrets scan; axe scans light and dark at desktop and phone size.
- [ ] Card: "212 of 340 variants not mapped" and "3 links need attention".
- [ ] `npm run check`, `npm run test:e2e`, `npm run test:browser` green. Commit `test(e2e): mapping journeys`.

## Checkpoints
After Task 3 (pure logic complete), after Task 8 (nothing touches a real supplier, safeguards proven), after Task 11 (all 11 spec success criteria, mapped below).

## Spec success criteria → tasks
1 → 5, 9. 2 → 4, 9. 3 → 2, 3, 6, 10. 4 → 1, 2, 6. 5 → 7, 8. 6 → 7. 7 → 5, 8. 8 → 8. 9 → 4. 10 → 2, 5. 11 → 11.

## Risks
| Risk | Mitigation |
|---|---|
| A supplier shows a normal page for every unknown address, so a gone product looks fine | Stored title and heading ("looks different"), and the owner's approval is the last gate. |
| Shopify's export columns differ from the sample | The column step lets the owner change them; unit tests cover a header with the app id in it. |
| A temporary redirect home (maintenance) looks like a gone product | Two checks 6 hours apart, supplier-wide guard, owner approval. |
| The pilot supplier's terms prohibit automation | Owner decided to proceed; the app refuses checks until permission is recorded. Real checks are not part of any automated test. |
| Pause is shorter than the supplier's crawl delay | Default 10 s; the owner sets it per supplier; tested. |

## Open questions
None blocking. Out of scope: region (a later supplier), metafield suggestions, scheduled checks (`scheduling`), reading stock (`extraction`), writing to Shopify (`proposals`).
