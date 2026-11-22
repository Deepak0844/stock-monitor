# Fresh browser for each run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-supplier "Fresh browser for each run" switch. When it is on, a supplier that needs no login starts every run, and every single-page visit, from an empty kept profile, and skips quick reads.

**Architecture:** A `fresh_profile` column on suppliers, set through the existing PATCH, like stealth. The worker sends `freshProfile: true` on the first page of a run and on one-page visits. In profile mode, the browser service wipes and re-seeds the site's profile before such a visit.

**Tech Stack:** TypeScript, Drizzle/PostgreSQL, Fastify, Playwright, React, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-22-fresh-profile-design.md`

## Global Constraints

- Off by default. Needs `automation_permission = 'granted'` (DB check constraint `suppliers_fresh_profile_permission`). Losing permission turns it off.
- Used only when `needsLogin` is false. Never wipes a supplier that needs a login.
- No retry after a refusal. A refused fresh run pauses the supplier as today.
- Commits: conventional types, no Claude attribution lines.

## Review Focus

- A supplier that needs a login with the switch left on (turned on while no login was needed): the worker must never send `freshProfile`. Tested in Task 4.
- Headless mode: `freshProfile` is accepted and ignored, with no error. Covered: headless captures never keep a profile.
- Later pages of a run must reuse the profile the first page made, so only the first `/capture` of a run carries `freshProfile`. Tested in Task 4.
- Permission withdrawn: `setPermission` turns `freshProfile` off in the same statement. Tested in Task 1.
- A bad value (`"yes"`) in the PATCH gets a 400 and changes nothing. Tested in Task 2.

---

### Task 1: Column and repository

**Files:** Modify `packages/db/src/schema.ts` (after `stealth`), `packages/db/src/supplier-repository.ts` (`SupplierRecord`, `setPermission`, `setAutoLogin`). Create the migration with `npx drizzle-kit generate --name fresh_profile` in `packages/db`. Test: `packages/db/test/supplier-repository.int.test.ts`.

**Produces:** `SupplierRecord.freshProfile: boolean`; `setAutoLogin(id, { freshProfile?: boolean, ... })` refuses `not_granted` when turning it on without permission.

- [ ] Test `"turns fresh browser on only with permission, and off when permission goes"`: `setAutoLogin(id, { freshProfile: true })` → `{ ok: false, reason: "not_granted" }`; after `setPermission(granted)` → ok, `freshProfile: true`; after `setPermission(unknown)` → `freshProfile: false`.
- [ ] Run it and see it fail. Implement `freshProfile: boolean("fresh_profile").notNull().default(false)` and the check `not fresh_profile or automation_permission = 'granted'`. Generate the migration. Run it and see it pass. Commit.

### Task 2: API PATCH

**Files:** Modify `apps/api/src/routes/suppliers.ts` (`AUTO_LOGIN_BODY`, validation, permission refusal). Test: `apps/api/test/suppliers.int.test.ts`.

- [ ] Tests mirroring stealth: refused without permission (409/`not_granted`, unchanged), allowed with permission, `"yes"` → 400 and unchanged.
- [ ] Implement, run, commit.

### Task 3: Browser service and client

**Files:** Modify `services/browser/src/server.ts` (`parse` accepts boolean `freshProfile`), `services/browser/src/profile-check.ts` (`inProfile`: when `request.freshProfile`, `seed(profile, request.state)` and rewrite `seeded` before launch), the request types, and `packages/browser-client/src/client.ts` (`capture` and `checkPage` send `freshProfile: true` only when true). Tests: `server.test.ts` (passes on a yes/no, 400 otherwise), `client.test.ts` (sent only when true), `test/profile-check.browser.test.ts` (a file planted in the profile survives a plain capture and is gone after a `freshProfile` capture).

- [ ] Write the tests, see them fail, implement, see them pass. The browser test is Linux-only and runs in CI's browser job. Commit.

### Task 4: Worker

**Files:** Modify `apps/worker/src/supplier-visit.ts` (`quickEligible` false when `freshProfile`), `apps/worker/src/extraction-check.ts` (`visit`/`browserVisit` take `fresh: boolean`; `runAll` passes `index === 0`; `checkStock` passes true), `apps/worker/src/extraction-capture.ts`, and `apps/worker/src/mapping-link-check.ts` (one-page visits pass it). Add a helper `freshFor(supplier) = supplier.freshProfile && !supplier.needsLogin`. Tests: `apps/worker/test/extraction-check.int.test.ts`, `mapping-link-check.int.test.ts`.

- [ ] Test `"starts a fresh-browser supplier's run with a fresh profile on the first page only"`: for a no-login supplier with the switch on, the `/capture` bodies' `freshProfile` values are `[true, undefined, undefined, undefined]`, and no `/quick-read` is requested.
- [ ] Test: the same supplier with `needsLogin` turned on sends no `freshProfile`.
- [ ] Test: a single `checkStock` sends `freshProfile: true`.
- [ ] Implement, run, commit.

### Task 5: Web switch

**Files:** Modify `apps/web/src/api.ts` (`Supplier.freshProfile`, `setAutoLogin` patch type), `apps/web/src/components/NeedsLoginCard.tsx`, `apps/web/src/test/fake-api.ts`. Test: `NeedsLoginCard.test.tsx`.

- [ ] Tests: the switch "Fresh browser for each run" shows only when no login is needed; clicking it calls `setAutoLogin(id, { freshProfile: true })`; it is disabled without permission.
- [ ] Implement, using the stealth row in `AutoLoginCard` as the pattern. Run, commit.

### Task 6: Verify and ship

- [ ] `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:integration`, all green.
- [ ] Push, open a PR to `develop`, rebuild local 3000 (`docker compose build api worker browser && docker compose up -d migrate api worker browser`), report.
