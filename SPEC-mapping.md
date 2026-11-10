# Spec: mapping

Module id: `mapping`. Depends on: `foundation` (done), `shopify` (read, done), `supplier-session` (supplier records, done except the pilot connect). Map: `CAPABILITY-MAP.md`. Intent: `docs/intent/stock-monitor.md`.

Status: **v2, owner answers received (2026-11-10).** The owner answered every open question (see the table below). Ready for the plan once the owner confirms this version. v2 records the owner's answers to the first draft's questions.

## Objective

Tell the app, for each Shopify variant you want watched, **which supplier page to look at**. A mapping is a link: this Shopify variant is the same item as that page on that supplier's website. The app only stores and checks the links. It does not read stock from the pages (that is `extraction`) and it never proposes anything (that is `proposals`).

User: the store owner, who is not technical. Success: the owner can map a supplier's variants quickly by uploading the Shopify product export, see at a glance which variants are not mapped, and be told plainly when a mapped link is wrong, moved or gone.

## Decisions recorded (owner, 2026-11-10)

| Question | Answer |
|---|---|
| How are links provided? | **CSV**, by uploading the **Shopify product export directly** (no separate file to build). |
| One page per variant, or shared? | **One page per variant.** No "option" field. |
| Region? | Needed only for one later supplier, **not in the pilot**. Left out of v1 and added when that supplier is onboarded. |
| Shopify metafield suggestions? | **Dropped for the MVP.** The Shopify sync is not touched. |
| When are links checked? | **When the owner asks** (one link, all of a supplier's links, or right after an import). Regular checks come with `scheduling`. |
| What does a 404 mean? | The owner wants a **404 to mean "product not available"** for the pilot supplier. See "Link status and what it means", which keeps safeguards so a typo or a redirect cannot wrongly mark an item unavailable. |
| Pilot supplier | **One supplier** (named in the project notes, not in this repo). The owner chose to go ahead with it. See "Permission to check": the terms risk is known and the owner's decision is recorded in the app. |
| Record permission in the app? | **Yes**, the per-supplier permission field. |
| Unavailable-candidate timing | **Yes** to two page-missing checks at least 6 hours apart, and 5 links and 30% for a supplier-wide problem. |
| SKU unique per variant? | **Yes.** Each `Variant SKU` is unique. |
| Redirect to the home page | **Counts as the product being gone**, the same as a 404. Same safeguards apply. See "Link status". |
| Shopify store | **Not connected yet.** The owner connects it after the app is built and tested. Until then the module is built and tested with made-up variants. |

## What exists today that this builds on

- `shopify_variants` holds every variant (id, product, title, options, SKU, stock). A variant that disappears from Shopify is marked removed, never deleted, so a mapping never loses its target.
- `suppliers` (with saved logins and statuses) and the browser service that can open a page with a saved login and say what it was (`ok`, login needed, puzzle, blocked, unreachable, unclear) together with the HTTP status. Its check can also read the page title and the final address.

## Assumptions (correct me now)

1. **A mapping is data only.** A supplier, a page address and a note. No selectors or steps: those belong to `extraction`.
2. **One mapping per variant** for the pilot, and the app refuses a second one with a plain message. The database allows several suppliers per variant from day one.
3. **Several variants may share one page address** (a duplicate is allowed but warned about in the import preview).
4. A mapping's page must be **on the supplier's own website** (same host, or a subdomain). A typo or a bad file cannot point the browser at an unrelated site.
5. Page addresses follow the same rules as supplier addresses: `https` only, no IP addresses, no `localhost`, nothing that resolves to a private address.
6. A link check **never says anything about stock**. It says whether the page loads, whether it is the page that was linked, and what happened if not.
7. Link checks use the supplier's saved login, **one page at a time**, with a pause between pages that is **at least the supplier's own crawl delay** (some suppliers publish 5 or 10 seconds in their `robots.txt`) and never less than 10 seconds by default. Each supplier's pause can be changed.
8. Notifications stay in the dashboard only (earlier decision).

## Permission to check (blocker for the pilot)

A read of the suppliers' terms (2026-11-10, by a fetch tool, not legal advice; the details are in the project notes) found that **the pilot supplier's terms prohibit automated access**, and require software acting for a person to identify itself. Its `robots.txt` also disallows account pages. Most of the other suppliers read so far prohibit collecting prices or content without written consent too, or say nothing about it. Silence is not permission.

The owner has decided to go ahead with this supplier as the pilot. Before any link check touches a real supplier, the owner records which of these applies: **get written permission** from the supplier (or a price and stock list), **choose a pilot whose terms allow it**, or knowingly accept the risk. The app records that decision:

- **Proposed:** a per-supplier field `automation_permission` (`unknown` by default, `granted`, `not_granted`) with a date and a note, set by the owner on the supplier's page. Link checks against a supplier that is not `granted` are refused with a plain message ("You have not recorded permission to check this supplier automatically. Open the supplier to record it."). Tests use the fake supplier, marked `granted`. This is a reminder and a record, not a legal control: the owner can set it.

## Behaviour

1. **Mappings page.** A table: Shopify product and variant, supplier, page (host and path), link status in words, last checked, actions. Filter by supplier and by link status. Search by product, variant or SKU. A clear empty state.
2. **Unmapped variants.** The variants with no mapping, with a count ("212 of 340 variants are not mapped"), a search, and a **Map** action on each row. Removed variants are shown separately and are not counted as unmapped.
3. **Add or edit by hand.** Pick the variant (searchable), pick the supplier, paste the page address, optionally a note. Plain-English errors beside each field. One mapping per variant.
4. **Import from the Shopify product export.** The owner uploads the file Shopify's **Products > Export** produces.
   - **Check columns step.** The screen shows the columns it found and lets the owner change them: the **SKU** column (`Variant SKU`), the **supplier name** column (the one whose header contains `supplier_name`) and the **page address** column. It suggests the address column by looking for the one whose cells hold a web address or a list of addresses, such as a metafield column the owner already fills with the supplier page address. The owner confirms.
   - **How rows are read.** Shopify writes a product's supplier name and address only on the product's **first row**, and writes extra rows for images and further variants. The app carries those product values down to the other variant rows with the same `Handle`, and ignores rows with no `Variant SKU` (image rows).
   - **The address cell** can be a plain address or a list written as `["https://…"]`. The app uses the first address in it. It removes the search-tracking parts `_pos`, `_psq`, `_psid` and `_ss` (and nothing else: `?variant=` stays) and shows the cleaned address in the preview.
   - **Which rows count.** Only rows whose supplier name matches a supplier in the app (ignoring capitals). Rows for other suppliers are counted as skipped ("48 rows are for suppliers not in the app"), not as errors.
   - **Preview before anything changes:** how many rows are good, which are new and which would replace an existing mapping, which are skipped, and every problem row with a reason in plain words ("SKU B0361 matches no variant", "SKU B0361 matches two variants", "that address is not on this supplier's website", "no address in that row", "the same SKU appears twice in the file"). The owner confirms and only good rows are saved. The same file can be imported again safely (it updates, never duplicates).
   - **After a confirmed import** the app offers **Check these links now**, which starts a link check for the new and changed mappings.
5. **Link check.** For one mapping, all of a supplier's mappings, or after an import, the app opens each page with the supplier's saved login and records what happened. See the next section for the results. A supplier that is not connected, is paused or has no recorded permission is not checked: the app says why in plain words.
6. **Changing or removing things.** Editing a page address resets its link history. Deleting a supplier deletes its mappings (after the existing confirmation). A removed Shopify variant keeps its mapping, shown as "Variant removed in Shopify".
7. **Never:** read or propose stock here, call a failed or blocked check "page missing", save a mapping to a page on another website, or change anything in Shopify.

## Link status and what it means

Each mapping has a status in words. The status says what happened to the **link**. It never says "out of stock".

| What happened | Status | What the owner is told |
|---|---|---|
| Not checked yet | **Not checked** | |
| The page loaded and looks like a normal page | **Works** | |
| The **first** checks never loaded a normal page (typo, wrong page) | **Never worked** | "This address never loaded the right page. Check it." |
| It worked before and now answers 404 or 410, loads a page saying "not found" or "no longer available", or **redirects to the supplier's home page** | **Page missing**, with "Worked until 5 Nov" | "The page is gone. The product may be discontinued." |
| The address redirects to another page that is **not** the home page, such as a category or a search page | **Moved** | "The supplier sends this address somewhere else." Not a stock status: never counts as page missing. |
| The page loads but its title or main heading is not what it was when it first worked | **Looks different** | "The page changed. Check it is still the same product." |
| The supplier asked for a login, a puzzle, or blocked the check | **Needs login** | The supplier's own status and notification are used. **The link is not marked broken.** |
| The supplier could not be reached, or the browser service is down | **Could not check** | Nothing is concluded. |

What the app stores to do this, and nothing more: the status, when each check ran, **when the link last worked**, the page's **title and main heading as they were when it first worked** (not stock, not prices), and the number and time of **consecutive page-missing checks**.

**Soft 404s.** A "not found" page served with a 200, or a redirect to the home page (which the owner treats as the product being gone), is recognised from the final address and the page wording, not from the status code alone. A supplier that serves a normal-looking page for every unknown address cannot be told apart by any check; the stored title and heading are the protection, and the owner's approval is the last one.

**Supplier-wide problems.** If a large share of one supplier's links go missing in the same run (proposed: at least 5 links and at least 30%), the app calls it a **supplier-wide problem**, such as a site change, an outage or a block. Those results do not count towards any link's missing total and nothing is proposed about stock.

**What "page missing" means for stock (owner's rule, kept behind safeguards).** For the pilot supplier the owner wants a missing page to mean "product not available". Mapping does not make that call. It exposes, for each mapping, **"unavailable candidate"** when all of these hold: the link **worked before**, it has been **page missing on two checks at least 6 hours apart** (proposed), and the last run was not a supplier-wide problem. `proposals` may then suggest "this item looks unavailable at this supplier" for the owner to **approve or reject**. Nothing is written to Shopify without that approval. A link that **never worked** is never a candidate. It is a wrong address to fix.

## Data model

| Table | Purpose |
|---|---|
| `mappings` | One link: `variant_id` (to `shopify_variants`), `supplier_id` (to `suppliers`, deleted with it), `url` (cleaned), `note`, `enabled`, `link_status` (`not_checked`, `works`, `never_worked`, `page_missing`, `moved`, `looks_different`, `needs_login`, `could_not_check`), `last_link_check_at`, `last_worked_at`, `worked_title`, `worked_heading`, `missing_checks` (count), `first_missing_at`, created and updated times. Unique on (`variant_id`, `supplier_id`). "One per variant" is a rule in the app, not the database, so it can be lifted without a migration. |
| `suppliers` (existing) | Gains `automation_permission` (`unknown`, `granted`, `not_granted`), `permission_note`, `permission_set_at`, and `check_pause_seconds` (default 10). |
| `import_previews` | Short-lived: a parsed upload waiting for the owner to confirm, so the preview and the import are the same rows. Deleted after use or after an hour. |

A status that says the supplier needs attention is never stored as "page missing".

## Security

- **Addresses** are validated by the same code as supplier addresses (https only, no IPs, no private networks, DNS check), then required to be on the supplier's site.
- **CSV is untrusted input:** size limit (the owner's export has long descriptions, so **10 MB**), row limit (**20,000**), a strict parser that never runs anything and handles quoted cells with commas and line breaks and a byte order mark, fields trimmed and length limited, and any cell starting with `=`, `+`, `-` or `@` is stored as text and never written back out as a formula. Descriptions and other columns the app does not need are read past and **never stored**.
- **Link checks go through the browser service**, with its network guard, so a mapped address can never reach a private network.
- No session, cookie or password is stored in a mapping, a job, a log or an audit event. Audit events record who created, changed, deleted or imported mappings and counts, never page contents.
- All routes need the signed-in owner.

## Interface (all need a signed-in owner)

`GET/POST /api/mappings`, `GET/PATCH/DELETE /api/mappings/:id`, `GET /api/variants?mapped=false`, `POST /api/mappings/import/columns` (reads the header and suggests columns), `POST /api/mappings/import/preview`, `POST /api/mappings/import/:previewId/confirm`, `POST /api/mappings/:id/check-link`, `POST /api/suppliers/:id/check-links`, `PATCH /api/suppliers/:id/permission`. Job: `mapping.link.check` with only `{ mappingId }`.

## Screens

- **Mappings**: the table, filters, search, **Add mapping**, **Import**, **Check links**.
- **Add or edit mapping**: variant picker, supplier, page address, note.
- **Import**: choose the Shopify export, **check columns**, preview with counts and per-row problems, confirm, result summary, **Check these links now**.
- **Unmapped variants**: counts, search, **Map** buttons.
- **Supplier page**: the permission record (status, note, date).
- Sidebar **Mappings**. The Dashboard gets a card: "212 of 340 variants not mapped" and "3 links need attention".

## Project structure

```
packages/mapping/        pure logic: Shopify export reader, column suggestion, row carry-down, address cleaning, row validation, matching SKUs to variants, link-status rules
packages/db/             new tables and columns, repositories
packages/supplier-session/ existing address validation is reused
apps/api/src/routes/     mappings, import, link checks, permission
apps/worker/src/         mapping-link-check.ts (the job)
apps/web/src/pages/      MappingsPage, MappingFormPage, ImportMappingsPage, UnmappedVariants
e2e/                     fake supplier pages for each case below
```

## Commands

`npm run check`, `npm run test:e2e`, `npm run test:browser`, `npm run db:generate` for the migration. No new commands.

## Code style

Same as the rest of the repo: small pure functions that return a result (not exceptions) for expected problems, plain-English messages, strict types.

```ts
export type RowCheck = { ok: true; mapping: ParsedRow } | { ok: false; message: string };
/** The messages are for the owner: they say what to fix, not what the code did. */
export function checkRow(row: ExportRow, suppliers: SupplierIndex, variants: VariantIndex): RowCheck { /* ... */ }
```

## Testing strategy

Test-first throughout. Automated tests never visit a real supplier.

**Unit:** the Shopify export reader (quoted cells with commas and line breaks, a long description, byte order mark, wrong encoding, huge files, formula cells, image-only rows, a product's first row carrying values for its later rows, a header with the app id in it); column suggestion; address cleaning (the four tracking parts, `?variant=` kept, list and plain forms, no address); row validation messages; matching by SKU (none, one, several, duplicate in file); the link-status rules.

**Link-status cases (fake supplier pages):** a correct URL; a wrong URL that never worked; a URL that worked and then returns 404; a 410; a "not found" page served with 200; a redirect to the home page on a link that worked before (page missing) and on a link that never worked (never worked); a redirect to a category (moved); a page whose title changed to another product; a login redirect; a puzzle; a block; a supplier that cannot be reached; a slow page; a whole supplier's links going missing at once; a page missing twice less than six hours apart and twice more than six hours apart.

**Integration (real PostgreSQL):** one mapping per variant, re-importing the same file changes nothing, deleting a supplier removes its mappings, a removed variant keeps its mapping, preview then confirm saves exactly the previewed rows, an import never stores descriptions or other unused columns, a supplier without recorded permission is refused.

**API:** every route needs the owner, plain errors. **Worker:** the link-check job against the stand-in browser service, including that a supplier needing attention is never turned into a broken link, the pause between pages, and that nothing about stock appears anywhere. **Browser journeys:** import the Shopify export, change a column, see the preview, confirm, filter unmapped, check links and see each status, record a supplier's permission, with accessibility scans in light and dark at desktop and phone size.

## Boundaries

- **Always:** validate every address, keep mappings on the supplier's own site, show a preview before importing, write audit events, honour the pause between pages, use the fake supplier in tests.
- **Ask first:** adding a dependency (a CSV library: I plan to write a small tested parser instead), changing the Shopify sync, changing how supplier sessions work, enabling Excel (`.xls` or `.xlsx`) import.
- **Never:** change anything in Shopify, store stock figures, save a mapping to another website, import without a preview, treat an unreachable or blocked page as "page missing", mark an item unavailable without the owner's approval, send a check to a supplier faster than its pause.

## Success criteria

1. A mapping can be added, edited, enabled or disabled, and deleted by hand, with plain errors for a bad address, a page on another site, a missing variant or supplier, and a second mapping for the same variant.
2. The Unmapped view counts and lists unmapped variants, searchable, with removed variants kept apart.
3. Uploading the owner's Shopify product export shows the suggested columns, then a preview, saves only good rows after confirming, skips other suppliers' rows, explains every bad row in plain words, and importing the same file twice leaves one mapping per variant.
4. A formula-looking cell is stored as plain text, descriptions are never stored, and the four tracking parts are removed from addresses while `?variant=` is kept.
5. A link check reports each case in the status table correctly, including **Never worked** for a wrong address, **Page missing** only for a link that worked before, **Page missing** for a redirect to the home page on a link that worked before, **Moved** for a redirect to a category or search page, and **Needs login** without marking the link broken.
6. Two page-missing checks at least six hours apart on a link that worked before make an **unavailable candidate**, and no other combination does. A supplier-wide problem makes none.
7. A supplier that is not connected, is paused or has no recorded permission is not checked, and the screen says why.
8. A link check never changes a supplier's status itself, never produces a stock figure, never contains a session or cookie, and never goes faster than the supplier's pause.
9. Deleting a supplier removes its mappings. A variant removed in Shopify keeps its mapping, labelled.
10. Page addresses are refused if they are `http`, an IP address, a private address, or on another website.
11. `npm run check` and the browser tests pass, including the accessibility scan of the new screens.

## Resolved questions (owner, 2026-11-10)

1. Pilot supplier: go ahead. The owner records the permission status in the app.
2. Permission field: yes. It is a reminder and a record the owner sets, not a legal control.
3. Timing: two page-missing checks at least 6 hours apart, and 5 links and 30% for a supplier-wide problem.
4. `Variant SKU` is unique per variant.
5. A link that redirects to the home page is treated as the product being gone, like a 404, with the same safeguards (worked before, two checks 6 hours apart, not supplier-wide, owner approval). A link that never worked and redirects home is **Never worked**.
