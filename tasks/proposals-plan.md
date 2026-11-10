# Implementation Plan: proposals

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (native) or superpowers:subagent-driven-development. Steps use `- [ ]` so progress shows.

**Goal:** Turn supplier stock answers into one-at-a-time suggestions the owner approves, and write an approved number to Shopify safely.

**Architecture:** Pure rules in a new `packages/proposals`. A `proposals.evaluate` job (ids only) creates, keeps, replaces or expires suggestions from the latest observation and the synced Shopify quantity. `proposals.apply` re-reads Shopify, refuses on any difference (conflict), then writes with `inventorySetQuantities` and `changeFromQuantity`. The only file allowed to contain that mutation is `packages/shopify/src/inventory-write.ts`. Built and tested against the fake Shopify only.

**Tech Stack:** TypeScript, Fastify, Drizzle + PostgreSQL, pg-boss 12, Vitest + Testcontainers, React, Playwright. No new dependency.

**Spec:** `SPEC-proposals.md` (approved 2026-11-10). Map: `CAPABILITY-MAP.md`.

Repo is public: no supplier names or domains in code, fixtures or docs. Never touch the owner's `.env`. Use npm. One branch from `develop` and one PR per task, merge only after `gh pr checks` is all green. Never `gh pr merge --delete-branch` while a worktree holds the branch. No Claude attribution in commits or PRs. Work in a worktree, never the owner's folder.

## Global Constraints (spec values, verbatim)
- A suggestion changes only `available` at the chosen location for one variant. Never tracking, continue-selling, price or another location.
- Rules: out of stock and Shopify > 0 gives set 0 ("Out of stock"); region not listed gives set 0 ("Not listed for <region>"); page missing only when the link may be unavailable (two checks 6+ hours apart) gives set 0 ("Page missing"); in stock and Shopify 0 gives the default quantity ("Back in stock"); in stock and Shopify > 0 gives nothing; out of stock and Shopify 0 gives nothing; cannot tell, or quantity and wording disagree, gives nothing, ever.
- Default quantity setting starts at **5**; the number is editable per suggestion (whole number, 0 or more, sensible upper limit). Expiry setting starts at **24 hours**.
- One open or approved suggestion per variant (partial unique index). A changed answer replaces it ("Replaced"); the same answer leaves it alone.
- Approve is one press on one suggestion. No bulk approve. Tracking off blocks Approve; continue-selling is a warning only.
- Without `write_inventory` Approve is refused in plain words and nothing is sent.
- Write: re-read Shopify first; if the number differs from `shopify_quantity_seen` the suggestion becomes `conflict` and nothing is written, never auto-retried, never overwritten. `changeFromQuantity` plus a stored idempotency key; unknown outcome retries 3 times at 10 s, 1 min, 5 min with the same key.
- Records and jobs hold ids and numbers only: no page text, address, session or secret. Records append-only history.
- `write_inventory` is **not** added to any real store. The module is not called done before the manual contract check against a development store.
- States: `open`, `approved`, `applied`, `conflict`, `failed`, `rejected`, `expired`, `replaced`.

## Review Focus (spec implies, tests pin it in the named task)
1. Approve pressed twice, or from two tabs, must write once (Tasks 2, 5).
2. Shopify number changes between suggestion and Approve: conflict, no write (Task 5).
3. Evaluate runs twice at once, or after a stale observation: still one open suggestion per variant, never from a cannot-tell (Tasks 1, 4).
4. Variant removed in Shopify, mapping turned off, supplier paused or deleted while a suggestion is open: it is closed or refused, no crash (Tasks 4, 6).
5. Worker killed after Shopify accepted but before the record was saved: the retry with the same key must not double-apply (Task 5).
6. Approving an edited number of 0, negative, decimal or huge value is refused with a plain message (Tasks 1, 6).

## Files
- Create `packages/proposals/{package.json,src/index.ts,src/rules.ts,src/rules.test.ts}`.
- Create `packages/db/drizzle/0010_proposals.sql`, `packages/db/src/proposal-repository.ts`; modify `packages/db/src/{schema.ts,index.ts}`.
- Create `packages/shopify/src/inventory-write.ts` (+ test); modify `packages/shopify/src/{index.ts,read-only.test.ts}`, `packages/shopify/test/testing.ts` (fake mutation).
- Modify `packages/queue/src/jobs.ts` (`proposals.evaluate`, `proposals.apply`).
- Create `apps/worker/src/{proposals-evaluate.ts,proposals-apply.ts}` (+ tests); modify `apps/worker/src/{worker.ts,index.ts,extraction-check.ts,mapping-link-check.ts,shopify-sync.ts,scheduling-tick.ts}`.
- Create `apps/api/src/routes/proposals.ts`; modify `apps/api/src/app.ts`.
- Create `apps/web/src/pages/{ProposalsPage.tsx,settings/ProposalSettings.tsx}`; modify `apps/web/src/{api.ts,App routes,sidebar}`, `apps/web/test/fake-api.ts`.
- Create `e2e/proposals.spec.ts`; modify `e2e/{stack.ts,control.ts}`, `playwright.config.ts`, `docs/deployment.md`, `CAPABILITY-MAP.md`.

## Dependency graph
```
1 rules ─┬─> 2 db ─┬─> 4 evaluate ─┐
         │         ├─> 5 apply  <── 3 shopify write
         │         └─> 6 api <──────┘
         └────────────────> 7 web <── 6
                              8 e2e <── 4,5,6,7  →  9 docs
```
Pure tasks 1 and 3 can be built first and in either order.

## Tasks

### Task 1: Pure rules (`packages/proposals`)
**Interfaces:** Produces `decideProposal(input): Proposal | null`, `validateQuantity(n, max): string | null` (plain reason or null), `expiresAt(now, hours)`, `isConflict(seen, current)`, `nextAfterUnknown(attempt): number | "give_up"` (10 s, 1 min, 5 min, then give up).
- [ ] Tests first, one per table row (all 7 rows including the three "Nothing" rows, region not listed, page missing only when `mayBeUnavailable`), cannot-tell and `quantityMismatch` never propose, Shopify quantity unknown (null) proposes nothing, edit validation (0 ok, -1, 1.5, NaN, over the limit refused), expiry, conflict, retry delays.
- [ ] Implement in `rules.ts`. No I/O, no dependency. Kind names: `set_zero_out_of_stock`, `set_zero_not_listed`, `set_zero_page_missing`, `restock`.
- [ ] `npm run check`, commit, PR, merge on green.

### Task 2: Database and repository
**Interfaces:** Consumes Task 1 kinds. Produces `createProposalRepository(db)` with `evaluateFor(variantId, wanted | null)` (create / keep / replace / close, atomic), `open()`, `history(page)`, `get(id)`, `markApproved(id, quantity, by)` (only from `open` and not expired, returns null otherwise, stores idempotency key once), `markApplied`, `markConflict`, `markFailed`, `reject(id, note)`, `expireDue(now)`, `settings()`/`saveSettings()` (keys `proposals.default_quantity`, `proposals.expiry_hours` in `app_settings`).
- [ ] Migration `0010_proposals.sql` and `schema.ts` per the spec's data model; partial unique index on `variant_id` where `state in ('open','approved')`; check constraints for states and kinds; cascades with supplier deletion.
- [ ] Integration tests (real PostgreSQL): create/keep/replace; two `evaluateFor` at once gives one open; `markApproved` twice gives one winner; rejected, expired, conflict cannot be approved; `expireDue`; history keeps replaced rows; supplier deletion removes rows; no column can hold page text (schema check).
- [ ] Implement, `npm run check`, commit, PR, merge on green.

### Task 3: Shopify write (fake first)
**Interfaces:** Produces `setAvailableQuantity(args: { client; inventoryItemId; locationId; quantity; changeFromQuantity; idempotencyKey }): Promise<{ result: "applied" | "changed" | "refused" | "no_permission" | "unknown"; newQuantity?: number }>`, and `readAvailable(client, inventoryItemId, locationId)`.
- [ ] Update `read-only.test.ts` so the mutation and `inventorySetQuantities` are allowed in `inventory-write.ts` only, and still fail anywhere else. Test that the guard still catches a mutation in another file.
- [ ] Fake Shopify: support `inventorySetQuantities` with `changeFromQuantity` compare (mismatch returns a user error), the idempotency key (same key returns the first result without changing again), a missing `write_inventory` scope, and controllable outcomes (refuse, throttle, drop the reply = unknown).
- [ ] Unit tests against the fake: applied, changed (compare fails), no permission, refused, network drop = `unknown`, same key twice writes once. Use the API 2026-10 idempotency mechanism (the directive form is checked against Shopify's docs while writing; if it differs from the spec's wording, record a ledger ruling).
- [ ] Implement, `npm run check`, commit, PR, merge on green.

### Task 4: Evaluate job
**Interfaces:** Consumes Tasks 1-2. Produces job `proposals.evaluate` `{ variantIds: string[] }` (ids only, strict) and handler `createProposalsEvaluateHandler`.
- [ ] Tests first: each table row end to end with real repository; a cannot-tell closes the open suggestion as "Latest check could not tell"; a variant removed or mapping disabled closes it; Shopify tracking off still creates it (warning is shown later); repeated run changes nothing; two at once gives one open.
- [ ] Handler reads the latest observation per enabled mapping and the synced quantity, and `mayBeUnavailable` from the mapping's missing-check fields. Never calls the Shopify write, never visits a supplier.
- [ ] Enqueue it at the end of a supplier check run, after a single link check, and after a Shopify sync (ids of the variants affected). The scheduling tick also calls `expireDue` once a minute.
- [ ] `npm run check`, commit, PR, merge on green.

### Task 5: Apply job
**Interfaces:** Consumes Tasks 2-3. Produces job `proposals.apply` `{ proposalId }` and handler.
- [ ] Tests first with the fake Shopify: happy path (state `applied`, quantity recorded, audit row); Shopify number changed since the suggestion gives `conflict` and no write; permission missing gives `failed` with a plain code; unknown outcome retries at 10 s, 1 min, 5 min with the same key then ends `failed` ("could not confirm, check Shopify"); worker run twice for one proposal writes once; a retry after "accepted but not saved" does not double-apply; suggestion not `approved` (rejected, expired) is skipped.
- [ ] Handler: re-read, compare, write, record, audit (ids and numbers only). Job options: `retryLimit: 0`, the retry delays are our own re-enqueue.
- [ ] `npm run check`, commit, PR, merge on green.

### Task 6: API
**Interfaces:** Consumes Tasks 2, 5. Produces `GET /api/proposals?state=open|history`, `POST /api/proposals/:id/approve` body `{ quantity?: number }`, `POST /api/proposals/:id/reject` body `{ note?: string }`, `GET/PUT /api/settings/proposals`.
- [ ] Tests first (signed-in owner only; 401 otherwise): approve creates the apply job and returns "Waiting for Shopify"; approve twice or after expiry or after reject is 409 with a plain message; no write permission is 409 and no job; tracking off is 409 with the spec's sentence; invalid edited number is 400 with a plain reason; reject needs no note; settings validate (default quantity 0-100000, expiry hours 1-720).
- [ ] Implement `routes/proposals.ts`, wire in `app.ts`. Responses hold ids, numbers, words and times only.
- [ ] `npm run check`, commit, PR, merge on green.

### Task 7: Web
**Interfaces:** Consumes Task 6.
- [ ] Component tests first (React Testing Library, fake API): list shows product, variant, SKU, supplier, what the supplier said with when, what Shopify shows, suggested number, warnings; Approve, Edit number (inline, validates), Reject; "Waiting for Shopify" then Applied; conflict and expired shown in plain words; History tab; empty state; settings form with the permission status line.
- [ ] Build `ProposalsPage.tsx` and the settings section. New sidebar item "Proposals" with a count badge. Plain words, same patterns as existing pages; invoke `ui-ux-pro-max` and `design-taste-frontend`; this is functional, not the polish pass.
- [ ] Browser accessibility scans (light and dark, phone and desktop) in the existing browser test style.
- [ ] `npm run check`, `npm run test:browser`, commit, PR, merge on green.

### Task 8: End to end
**Interfaces:** Consumes everything. Produces `e2e/proposals.spec.ts`, Playwright projects `proposals-desktop`, `proposals-phone`, and `control` hooks to set the fake Shopify quantity and scopes.
- [ ] Journeys: out of stock supplier plus Shopify 4 shows "Set to 0", Approve, Shopify shows 0 and History shows Applied; back in stock with Shopify 0 shows the default, edited to another number is written; change Shopify between suggestion and Approve gives conflict and nothing written; reject; expiry (use `control.tick`-style clock hook); no write permission refuses Approve; a check that cannot tell shows nothing. No real supplier or Shopify.
- [ ] Run the full local Playwright suite, commit, PR, merge on green.

### Task 9: Docs and contract-check note
- [ ] `docs/deployment.md`: "Stock suggestions" section in plain words (how to read a suggestion, what Approve does, why it can refuse, how to grant `write_inventory` only on a development store first). `CAPABILITY-MAP.md`: proposals "built against fake Shopify; contract check pending".
- [ ] Add a manual contract-check checklist (create dev store, grant write permission there, approve one suggestion, confirm quantity, confirm conflict) to the doc. The module stays "not done" until the owner has run it.
- [ ] `npm run check`, commit, PR, merge on green.

## Self-review against the spec
Coverage: rules table (1), one-per-variant, expiry, settings (2, 4), write safety, conflict, unknown outcome, idempotency (3, 5), permission and tracking refusals (6), screens (7), journeys (8), docs and contract check (9), audit and no-content records (2, 5, 6). Bulk approve and any real-store write are excluded by design.
