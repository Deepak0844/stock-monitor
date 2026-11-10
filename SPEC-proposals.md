# Spec: proposals (and the Shopify write)

Module id: `proposals`. Depends on: `foundation`, `shopify` (read: variants, quantities, location, scopes), `supplier-session`, `mapping` (links, link status, "may be unavailable" test), `extraction` (observations), `scheduling` (regular checks). Map: `CAPABILITY-MAP.md`. Intent: `docs/intent/stock-monitor.md`. Shopify contract: `SPEC-shopify.md` ("Phase B contract").

Status: **draft v2, all six questions answered (2026-11-10); awaiting approval.** No plan and no code until it is approved.

## Objective

Turn what the app saw on a supplier's page into a **suggested change to the stock quantity in Shopify**, show it to the owner, and write it to Shopify **only after the owner approves that specific change**. Then record exactly what happened.

User: the store owner, not technical. Success: after a check, the owner opens one inbox, sees "Blue Tee, Large: supplier says Out of stock, Shopify shows 4, suggested 0", presses Approve, and a moment later it says "Applied: Shopify now shows 0", with the whole history kept. Nothing is ever written without that press. A login problem, puzzle, block, changed page or anything unclear never produces a suggestion, and never "out of stock".

Never, by the intent: automatic Shopify updates. Not in this module either.

## What exists today that this builds on

- `stock_observations`: for each link, the answer (`in_stock`, `out_of_stock`, `cannot_tell`), the reason (for example "not listed for a region", "page missing", "page changed"), the quantity the supplier showed when it showed one, when it was seen, and which rules produced it.
- `mappings`: one link per variant, link status, and the "may be unavailable" test (two missing-page checks at least 6 hours apart, not supplier-wide).
- `shopify_variants`: each variant's last synced `available` at the owner's chosen location, whether Shopify tracks it, and whether it keeps selling at 0. `shopify_connection` reports the permissions actually granted. The sync is a button today.
- Scheduling: regular supplier checks, run records, notifications on the Dashboard.
- The read-only Shopify client. **No Shopify write exists yet**, and the app's Shopify permission is read-only.

## Decisions I am proposing (change any of them)

1. **A proposal is one change to one number**: the `available` quantity of one variant at the chosen location. Nothing else (not tracking, not "continue selling", not prices, not another location).
2. **What the supplier saw decides the suggestion**:

| Latest answer for the link | Shopify shows | Suggestion |
|---|---|---|
| Out of stock (rules matched, or region number 0) | more than 0 | **Set to 0**, labelled "Out of stock" |
| Out of stock because the region is not listed (rest of the table still there) | more than 0 | Set to 0, labelled "Not listed for <region>" |
| Page missing (404 or home page), and the link **may be unavailable** (two checks 6+ hours apart) | more than 0 | Set to 0, labelled "Page missing" |
| In stock | 0 | **Set to the default quantity** (a setting), labelled "Back in stock" |
| In stock | more than 0 | Nothing (Shopify already says there is stock) |
| Out of stock | 0 | Nothing |
| Cannot tell (any reason), or quantity and wording disagree | any | **Nothing, ever.** An open suggestion for the link is marked "Latest check could not tell". |

3. **One open suggestion per variant.** A newer check that changes the answer replaces the open suggestion (the old one is kept in the history as "Replaced"). A newer check with the same answer leaves it alone.
4. **The owner can edit the number** before approving (a whole number from 0 up). An edited suggestion is marked "Edited by you".
5. **Approving is one press on one suggestion.** There is no "approve all" in this module (the intent defers bulk approval until after the pilot).
6. **Suggestions expire.** An open suggestion not decided within the expiry time is marked "Expired" and cannot be approved. The expiry time is a setting and starts at 24 hours (the owner asked for shorter than my proposed 3 days; with daily checks, a stale suggestion is replaced by the next check anyway). The next check makes a fresh one if it still applies.
7. **Tracking off or "continue selling" on** are shown on the suggestion as warnings, as in the variants list. Tracking off blocks Approve with the plain reason ("Shopify is not tracking stock for this item, so changing the quantity would have no effect"). Continue selling is a warning only; the app never changes either setting.

## The Shopify write (the careful part)

The write is `inventorySetQuantities` on `available` at the chosen location, exactly as `SPEC-shopify.md` describes. Rules:

1. **Permission first.** The app asks Shopify for `write_inventory` only when this module is turned on, as a new app version the owner approves in Shopify. Until Shopify reports that permission, **Approve is refused** with a plain message and nothing can be written, so "the app cannot write" stays true at the permission level.
2. **Re-read before writing.** On Approve the worker reads the variant's quantity from Shopify right then.
3. **Stale means stop.** The quantity the owner saw (stored on the suggestion when it was made or last refreshed) must equal what Shopify shows now. If not, the suggestion becomes **Conflict**: "Shopify now shows 7. It showed 4 when this was suggested. Nothing was changed." The owner can press **Refresh** (re-reads Shopify and the latest check and makes a new suggestion) but **nothing is overwritten and nothing is retried automatically**. The mutation also carries `changeFromQuantity` equal to the re-read quantity, so Shopify refuses a change that slipped in between.
4. **Only the approved number is written**: the worker takes the quantity from the approved suggestion and nowhere else.
5. **One approval can never apply twice.** Approving creates an idempotency key stored on the suggestion. A retry after a network failure reuses it. A suggestion that is already applied, rejected, expired or in conflict cannot be approved again.
6. **Unknown outcome.** If the network fails after the request may have reached Shopify, the worker re-reads the quantity: equal to the target means Applied; equal to the old number means it did not happen (it may be retried with the same key, up to 3 tries with waits of 10 seconds, 1 minute, 5 minutes); anything else is a Conflict. If Shopify cannot be reached at all it stays "Approved, waiting" and is shown as such, never as applied.
7. **Record everything**: who approved, when, the numbers (supplier answer, Shopify before, suggested, edited, written), the idempotency key, Shopify's reply summary, and the outcome. Records are append-only for the numbers.
8. **Reason and reference in Shopify**: the mutation's reason is "correction" and its reference document points back to the suggestion's id in this app, so the change is traceable from Shopify's inventory history.

## The suggestion's life

`open` → `approved` → `applied`, or `conflict`, or `failed` (Shopify refused for a reason shown in plain words). Also `open` → `rejected` (the owner's choice, with an optional note), `expired`, or `replaced`. `approved` with no answer yet is shown as "Waiting for Shopify".

## Screens (functional, in the existing style)

UI polish is a separate step the owner will ask for: this module uses the existing patterns and layout only.

- **Proposals** (new item in the sidebar): a list of suggestions waiting, each with product, variant, SKU, supplier, what the supplier said (words and when it was seen), what Shopify shows, the suggested number, warnings, and the buttons **Approve**, **Edit number**, **Reject**. A second tab, **History**, shows applied, rejected, expired, replaced, conflict and failed ones with their numbers.
- **Dashboard:** a count "N changes waiting for your approval" linking to Proposals; a conflict or failure raises one Dashboard notice.
- **Settings:** the default quantity (for "Back in stock") and the expiry time. An explanation and the status of the Shopify write permission ("Shopify has not given this app permission to change stock yet" / "Ready").
- **Links page:** the link's latest suggestion state in words.

## How suggestions are made

A small job `proposals.evaluate` (ids only) runs at the end of a supplier's check run, after a single link check, and after a Shopify sync. For each affected link it takes the **latest observation** and the **last synced Shopify quantity**, applies the table above, and creates, keeps, replaces or expires the open suggestion. It is safe to run repeatedly. It never calls Shopify's write and never visits a supplier.

## Data model

| Table | Purpose |
|---|---|
| `proposals` | One row per suggestion: `id`, `variant_id`, `mapping_id`, `supplier_id`, `observation_id`, `kind` (`set_zero_out_of_stock`, `set_zero_not_listed`, `set_zero_page_missing`, `restock`), `shopify_quantity_seen`, `proposed_quantity`, `approved_quantity` (nullable), `edited` (bool), `state`, `created_at`, `expires_at`, `decided_at`, `decided_by`, `note`, `idempotency_key` (nullable), `applied_at`, `result_code` (nullable fixed code), `result_quantity` (nullable). A partial unique index allows one `open` or `approved` row per variant. |
| `app_settings` (existing) | `proposals.default_quantity`, `proposals.expiry_hours`. |

Numbers and codes only: no page text, no addresses, no session or credential data in a proposal, a log, an audit event or a job.

## Security

- Every route needs a signed-in owner. Approve, Reject, Edit and Refresh are separate requests, each audited with who and the numbers.
- The write permission is a Shopify permission, not only a check in code: with read-only permission the write call fails at Shopify.
- The worker's write function accepts only a proposal id, loads the approved row, and takes nothing from the request. It refuses any row that is not `approved`.
- Job payloads are ids only. Logs and audit events carry counts, codes and ids, never tokens or secrets.
- The Shopify domain check, token handling and redaction of the read-only client are reused unchanged.

## Interface (all need a signed-in owner)

- `GET /api/proposals?state=open|history` and `GET /api/proposals/:id`.
- `POST /api/proposals/:id/approve` (optionally with an edited number), `POST /api/proposals/:id/reject` (optional note), `POST /api/proposals/:id/refresh`.
- `GET/PUT /api/settings/proposals` (default quantity, expiry), and the write-permission status from the existing connection check.

## Project structure

- `packages/proposals`: pure rules (the table above, expiry, edit validation, conflict test, unknown-outcome decision). No I/O.
- `packages/shopify`: `setAvailable(...)` (the Phase B function) and a `readAvailable(inventoryItemId, locationId)` single read; tests against the fake Shopify server extended with `inventorySetQuantities`.
- `packages/db`: migration and repositories.
- `packages/queue`: jobs `proposals.evaluate`, `proposals.apply` (ids only).
- `apps/worker`: the evaluate and apply handlers. `apps/api`: routes. `apps/web`: Proposals, settings and Dashboard parts.

## Testing strategy

- **Unit (no I/O):** every row of the table, including the "Nothing" rows; "cannot tell" never proposes; expiry; edit validation (whole number, 0 or more, a sensible upper limit); conflict test; the unknown-outcome decision.
- **Fake Shopify server:** `inventorySetQuantities` that honours `changeFromQuantity` and the idempotency key, can return the stale-quantity error, a user error, a throttle, and drop the connection after applying. Tests: applied; stale conflict never retried; the same approval retried after a dropped connection applies once; tracking off.
- **Integration (real PostgreSQL):** evaluate creates, keeps, replaces and expires; one open per variant (two evaluates at once); approve twice gives one write; a rejected, expired or conflicted suggestion cannot be approved; read-only permission refuses Approve; rows hold no page content or secrets; supplier deleted removes its suggestions.
- **Browser and end to end:** Proposals list, edit, approve, reject, conflict and expired; the fake Shopify and fake supplier; accessibility scans in light and dark; a check that cannot tell shows no suggestion; no real Shopify or supplier is touched.
- **Manual contract check against a Shopify development store** (a fake server proves our code, not Shopify's behaviour). Recorded in the PR. Required before this module is called done, and before the permission is added to the owner's real store.

## Boundaries

- **Always:** require the owner's press for every write; re-read Shopify before writing; send `changeFromQuantity` and an idempotency key; keep the numbers in an append-only record; treat anything unclear as "nothing to suggest".
- **Ask first:** adding the `write_inventory` permission to the owner's real store; changing the API version; any write other than `available` at the chosen location; a dependency.
- **Never:** write without an approved suggestion; approve automatically or in bulk; retry a stale-quantity conflict by itself; overwrite a changed Shopify quantity; change tracking, "continue selling", prices or another location; suggest from a login, puzzle, block, changed or unclear page; touch the owner's real store from a test.

## Success criteria

1. After a check, an out-of-stock link whose Shopify quantity is above 0 shows one suggestion "Set to 0" with the supplier's words, the time it was seen, and Shopify's number.
2. A link that is in stock with Shopify at 0 shows "Back in stock" with the default quantity. In stock with Shopify above 0, and out of stock with Shopify at 0, show nothing.
3. Cannot tell (login, puzzle, block, changed, quantity and wording disagreeing) never shows a suggestion; an open one is marked as not confirmed.
4. A missing page suggests 0 only when the link may be unavailable (two checks 6+ hours apart, not supplier-wide).
5. Approve writes exactly the approved number once. Pressing it twice, or retrying after a dropped connection, never applies twice.
6. If Shopify's quantity changed since the suggestion, the result is Conflict with a plain message; nothing is written, and nothing is retried by itself.
7. The owner can edit the number (whole number, 0 or more) before approving; Reject needs no reason; an expired suggestion cannot be approved.
8. Without the Shopify write permission, Approve is refused in plain words and nothing is sent.
9. Every decision and write is recorded with who, when and the numbers; the history lists them; no page text, address, session or secret is in any record, log or job.
10. `npm run check`, the browser tests and the browser journeys pass, including the accessibility scan, and the contract check against a development store is recorded.

## Resolved questions (owner, 2026-11-10)

1. **Default quantity:** a setting in the app (starting value 5, my proposal), and the number on each "Back in stock" suggestion can be edited before approving, so the owner can type a different one every time.
4. **Missing pages:** suggest 0 only after the link has been flagged "may be unavailable" (two checks 6+ hours apart). Confirmed.
5. **Development store:** later. Everything is built and tested against the fake Shopify server first. The `write_inventory` permission is **not** added to any real store, and the manual contract check against a development store waits until the owner has one. The module is not called done before that check.

2. **When to suggest:** set to 0 only when Shopify shows more than 0; suggest the default quantity only when Shopify shows 0. Confirmed.
3. **Expiry:** shorter than 3 days. I chose **24 hours** as the starting value (my call, since the owner gave no number); it is a setting the owner can change in the app.
6. **Approving:** one suggestion at a time, no "approve all", for the pilot. Confirmed.

## Still open for the owner

1. **Approve this version?** If anything is not what you want, say what to change.
