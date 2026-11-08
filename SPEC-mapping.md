# Spec: mapping

Module id: `mapping`. Depends on: `foundation` (done), `shopify` (read, done), `supplier-session` (supplier records, done except the pilot connect). Map: `CAPABILITY-MAP.md`. Intent: `docs/intent/stock-monitor.md`.

Status: **draft for owner review.** Not approved. No code is written until it is.

## Objective

Tell the app, for each Shopify variant you want watched, **which supplier page to look at**. A mapping is a link: this Shopify variant is the same item as that page on that supplier's website, optionally for one region. The app only stores and checks the links. It does not read stock from the pages (that is `extraction`) and it never proposes anything (that is `proposals`).

User: the store owner, who is not technical. Success: the owner can map the pilot supplier's variants quickly (by hand, by a spreadsheet, or by accepting suggestions), see at a glance which variants are not mapped yet, and be told plainly when a mapped page no longer works.

## What exists today that this builds on

- `shopify_variants` already holds every variant (id, product, title, options, SKU, stock). A variant that disappears from Shopify is marked removed, never deleted, so a mapping never loses its target.
- `suppliers` (with saved logins and statuses) and the browser service that can open a page with a saved login and say what it was (`ok`, login needed, puzzle, blocked, unreachable, unclear) together with the HTTP status.
- The Shopify sync reads no metafields yet.

## Assumptions (correct me now)

1. **A mapping is data only.** It has a supplier, a page address, and a few hints. It has no selectors or steps: those belong to `extraction`.
2. **Pilot scope, as agreed:** one supplier, and **one mapping per variant**. The database allows several suppliers per variant from day one. The app refuses a second one for now, with a plain message.
3. **Several variants may share one supplier page** (for example one page with a size dropdown). So the page address alone is not unique.
4. A mapping's page must be **on the supplier's own website** (same host, or a subdomain of it). Otherwise a typo or a bad CSV could point the browser at an unrelated site.
5. Page addresses follow the same rules as supplier addresses: `https` only, no IP addresses, no `localhost`, nothing that resolves to a private address.
6. **A link check never says anything about stock.** It says whether the page still loads and looks like the same kind of page.
7. Link checks use the supplier's saved login, one page at a time, with a pause between pages, so a supplier is not hammered.
8. Notifications stay in the dashboard only (earlier decision).

## Behaviour

1. **Mappings page.** A table of mappings: Shopify product and variant, supplier, page (host and path), region, link status in words, last checked, actions. Filter by supplier and by link status. Search by product, variant or SKU. A clear empty state.
2. **Unmapped variants.** A view of the variants with no mapping, with a count ("212 of 340 variants are not mapped"), a search, and a **Map** action on each row. Removed variants are shown separately and are not counted as unmapped.
3. **Add or edit by hand.** Pick the variant (searchable), pick the supplier, paste the page address, optionally a region and a note. Plain-English errors beside each field. One mapping per variant for now.
4. **CSV import.** Upload a file with one row per variant. Columns: `sku` (or `variant_id`), `supplier` (its name), `url`, and optionally `region`. The app shows a **preview** before anything changes: how many rows are good, which are new and which would replace an existing mapping, and every problem row with a reason in plain words ("SKU AB-12 matches no variant", "SKU AB-12 matches two variants", "that address is not on Acme's website"). The owner then confirms, and only the good rows are saved. Nothing is saved before confirming. The same file can be imported again safely (it updates, never duplicates).
5. **Suggestions from a Shopify metafield (optional, see Open Questions).** If the owner keeps the supplier's name (or page) in a Shopify metafield, the sync reads it and the Unmapped view shows it as a **suggestion** with an **Accept** button. Suggestions are never applied without a click.
6. **Link check.** For one mapping, all of a supplier's mappings, or after an import, the app opens each page with the supplier's saved login and records what happened. Results, in words:
   - **Works**: the page loaded and looks normal.
   - **Page missing**: the supplier answered 404 or 410.
   - **Needs login**: the supplier asked for a login, a puzzle or blocked it. This is about the supplier's session, not the link, so the mapping is **not** marked broken and the supplier's own status and notification are used (Task 10 of `supplier-session`).
   - **Looks different**: the page loaded but did not look like a normal page (the classifier said unclear).
   - **Could not check**: the supplier could not be reached, or the browser service is down. Nothing is concluded.
   A supplier that is not connected, or is paused, is not checked: the app says "Connect this supplier first" instead.
7. **Changing or removing things.** Editing a page address resets its link status to "Not checked". Deleting a supplier deletes its mappings (after the existing confirmation). A removed Shopify variant keeps its mapping, shown as "Variant removed in Shopify".
8. **Never:** read or propose stock here, call a failed or blocked check "out of stock" or "page missing", save a mapping to a page on another website, or change anything in Shopify.

## Data model

| Table | Purpose |
|---|---|
| `mappings` | One link: `variant_id` (to `shopify_variants`), `supplier_id` (to `suppliers`, deleted with it), `url`, `region` (optional text), `note` (optional), `enabled`, `link_status` (`not_checked`, `works`, `page_missing`, `needs_login`, `looks_different`, `could_not_check`), `last_link_check_at`, created and updated times. Unique on (`variant_id`, `supplier_id`). The "one per variant" rule is in the app for now, not the database, so it can be lifted later without a migration. |
| `shopify_variants` (existing) | Gains `supplier_hint` (text, optional): the metafield value, if that feature is wanted. |
| `import_previews` | Optional and short-lived: a parsed upload waiting for the owner to confirm, so the preview and the import are the same rows. Deleted after use or after an hour. |

`link_status` values map one to one to the words above. A status that says the supplier needs attention is never stored as "page missing".

## Security

- **Addresses** are validated by the same code as supplier addresses (https only, no IPs, no private networks, DNS check), then required to be on the supplier's site.
- **CSV is untrusted input:** size limit (2 MB), row limit (5,000), a strict parser that never runs anything, fields trimmed and length limited, and any cell starting with `=`, `+`, `-` or `@` is stored as text and is never written back out as a formula.
- **Link checks go through the browser service**, with its network guard, so a mapped address can never reach a private network.
- No session, cookie or password is stored in a mapping, a job, a log or an audit event. Audit events record who created, changed, deleted or imported mappings and counts, never page contents.
- All routes need the signed-in owner.

## Interface (all need a signed-in owner)

`GET/POST /api/mappings`, `GET/PATCH/DELETE /api/mappings/:id`, `GET /api/variants?mapped=false` (the unmapped view, with search), `POST /api/mappings/import/preview` (the file), `POST /api/mappings/import/:previewId/confirm`, `POST /api/mappings/:id/check-link`, `POST /api/suppliers/:id/check-links`. Job: `mapping.link.check` with only `{ mappingId }`.

## Screens

- **Mappings**: the table above, filters, search, **Add mapping**, **Import CSV**, **Check links**.
- **Add or edit mapping**: variant picker, supplier, page address, region, note.
- **Import**: choose file, preview with counts and per-row problems, confirm, result summary. A small "what the file should look like" sample with a downloadable example.
- **Unmapped variants**: counts, search, Map and Accept buttons.
- The sidebar gets a **Mappings** item. The Dashboard gets a small card: "212 of 340 variants not mapped" and "3 links need attention".

## Project structure

```
packages/mapping/        pure logic: CSV parser, row validation, matching rows to variants, link-status rules (no database, no browser)
packages/db/             new tables and repositories
packages/supplier-session/ existing address validation is reused
apps/api/src/routes/     mappings, import, link checks
apps/worker/src/         mapping-link-check.ts (the job)
apps/web/src/pages/      MappingsPage, MappingFormPage, ImportMappingsPage, UnmappedVariants
e2e/                     fake supplier pages for 200, 404, login redirect, puzzle
```

## Commands

`npm run check`, `npm run test:e2e`, `npm run test:browser`, `npm run db:generate` for the migration. No new commands.

## Code style

Same as the rest of the repo: small pure functions that return a result (not exceptions) for expected problems, plain-English messages, strict types.

```ts
export type RowCheck = { ok: true; mapping: ParsedRow } | { ok: false; message: string };
/** The messages are for the owner: they say what to fix, not what the code did. */
export function checkRow(row: CsvRow, suppliers: SupplierIndex, variants: VariantIndex): RowCheck { /* ... */ }
```

## Testing strategy

Test-first throughout. **Unit:** CSV parsing (quotes, commas, line breaks inside cells, byte order mark, wrong encoding, huge files, formula cells), row validation messages, matching by SKU (none, one, several), the link-status rules (404 and 410 are "page missing", login or puzzle is "needs login" and never "page missing"). **Integration (real PostgreSQL):** the one-mapping-per-variant rule, re-importing the same file changes nothing, deleting a supplier removes its mappings, a removed variant keeps its mapping, preview then confirm saves exactly the previewed rows. **API:** every route needs the owner, plain errors. **Worker:** the link-check job against the stand-in browser service, including that a supplier needing attention is not turned into a broken link, and that nothing numeric about stock appears anywhere. **Browser journeys:** map by hand, import a file with good and bad rows, see the preview, confirm, filter unmapped, check links and see "Page missing" and "Needs login" for the right pages, with accessibility scans in light and dark at desktop and phone size. Automated tests never visit a real supplier.

## Boundaries

- **Always:** validate every address, keep mappings on the supplier's own site, show a preview before importing, write audit events, use the fake supplier in tests.
- **Ask first:** adding a dependency (a CSV library: I plan to write a small tested parser instead), changing the Shopify sync (needed only for the metafield feature), changing how supplier sessions work.
- **Never:** change anything in Shopify, store stock figures, save a mapping to another website, import without a preview, treat an unreachable or blocked page as "page missing".

## Success criteria

1. A mapping can be added, edited, enabled or disabled, and deleted by hand, with plain errors for a bad address, a page on another site, a missing variant or supplier, and a second mapping for the same variant.
2. The Unmapped view counts and lists the unmapped variants, searchable, and removed variants are kept apart.
3. A CSV import shows a preview first, saves only good rows after confirming, explains every bad row in plain words, and importing the same file twice leaves one mapping per variant.
4. A formula-looking cell in a CSV is stored as plain text.
5. A link check marks a 404 or 410 as **Page missing**, a normal page as **Works**, an unclear page as **Looks different**, and a login, puzzle or block as **Needs login** without marking the link broken.
6. A supplier that is not connected is not checked, and the screen says so.
7. A link check never changes a supplier's status itself, never produces a stock figure, and never contains a session or cookie.
8. Deleting a supplier removes its mappings. A variant removed in Shopify keeps its mapping, labelled.
9. Page addresses are refused if they are `http`, an IP address, a private address, or on another website.
10. `npm run check` and the browser tests pass, including the accessibility scan of the new screens.
11. If the metafield feature is wanted: suggestions appear for unmapped variants, are never applied without a click, and the sync still only reads from Shopify.

## Open questions for the owner

1. **How will you give the app the mappings?** By hand, from a spreadsheet, or both? If a spreadsheet, what columns do you already have (SKU, supplier page address, region)? **How many variants are in the pilot?** (This is also an earlier open question.)
2. **Does each variant have its own supplier page, or does one page cover several variants** (for example one page with a size or colour choice)? If a page has choices, the mapping may need to say which choice (`option`) so `extraction` reads the right one.
3. **What does "region" mean for your pilot supplier?** For example a country or warehouse picker on the page. Is it needed for the pilot, or can it wait?
4. **Do you keep the supplier's name or page address in a Shopify metafield today?** If yes, which one (its namespace and key, and whether it is on the product or the variant)? If not, I will drop the suggestions feature, which also means the Shopify sync is not touched.
5. **When should links be checked?** My proposal: when you ask (one, all of a supplier's, or after an import). Regular checks come with the scheduling module. Is that right for now?
6. **Is one pilot supplier still the plan,** and is its name and website now something you can share (the supplier connect is still waiting on you)?
