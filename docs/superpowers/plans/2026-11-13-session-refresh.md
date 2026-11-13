# Session Refresh and Early Login Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Save the refreshed cookies after every check that found a logged-in page, and check each supplier's login 2 hours before its scheduled run.

**Architecture:** The browser service adds an optional `state` to each check outcome when `result` is `ok`. The worker merges it into the stored session and seals it again, guarded by a compare-and-swap on `state_iv`. The scheduler tick queues one early `supplier.session.verify` per upcoming run, inside the supplier's allowed hours.

**Tech Stack:** TypeScript, Playwright, Drizzle + Postgres, pg-boss, Vitest (unit, `.int.test.ts` with testcontainers, `.browser.test.ts`).

**Spec:** `docs/superpowers/specs/2026-11-13-session-refresh-design.md`

## Global Constraints

- `state` is returned **only** when `result === "ok"`. Never on `login_required`, `captcha`, `blocked`, `unreachable` or `unknown`.
- Cookie names, values and session state never appear in logs, audit details, job payloads or error messages.
- The browser service never holds the sealing key. The worker reseals with the loaded session's own `keyId`.
- A refresh never changes `saved_at`. It sets `last_verified_at` to `now()`.
- The compare-and-swap key is `supplier_sessions.state_iv`.
- `SESSION_CHECK_LEAD_MINUTES = 120`, a constant.
- An early check acts only on `login_required`, `captcha` and `blocked`. `unknown` is audited but marks nothing.
- No early check outside the supplier's window (`insideWindow`).
- Use npm, not pnpm. Branch `feature/session-refresh` from `develop`. No Claude attribution in commits or the PR.
- Never touch the owner's `.env` or their Compose stack. Tests use testcontainers.

## Review Focus

1. **The owner logs in again while a stock run is going.** The run's refresh must not overwrite the new login. Test in Task 4 (`refresh` returns false on a changed IV) and Task 5 (the run saves nothing after a reconnect).
2. **A cookie file without session-only cookies.** The merge must keep the old unexpired cookie, or the supplier is logged out silently. Test in Task 1.
3. **The early check meets an unreachable supplier.** It must not be queued again on the next tick. Test in Task 6.
4. **A supplier with an hourly schedule.** The last run already proved the login, so no early check. Test in Task 6.
5. **A captcha page classified `ok` by mistake** carries third-party cookies. Saving them is harmless (merge only adds), but the audit must still hold no cookie data. Test in Task 5 (the audit details contain only `supplierId`-level facts).

---

### Task 1: Merge and compare session states

**Files:**
- Create: `packages/supplier-session/src/merge.ts`
- Modify: `packages/supplier-session/src/index.ts` (export it)
- Test: `packages/supplier-session/src/merge.test.ts`

**Interfaces:**
- Produces: `mergeSessionState(saved: SessionState, fresh: SessionState, nowSeconds: number): SessionState` and `sameSessionState(a: SessionState, b: SessionState): boolean`.

- [ ] **Step 1: Write the failing tests**

```ts
const c = (name: string, value: string, expires = -1, domain = ".acme.example", path = "/") => ({ name, value, domain, path, expires });
it("a fresh cookie replaces the saved one with the same name, domain and path", () =>
  expect(mergeSessionState({ cookies: [c("sid", "old")], origins: [] }, { cookies: [c("sid", "new")], origins: [] }, 1000).cookies).toEqual([c("sid", "new")]));
it("keeps a saved cookie the fresh state left out, so a session-only cookie is not lost", () =>
  expect(mergeSessionState({ cookies: [c("sid", "x")], origins: [] }, { cookies: [c("_ga", "y", 5000)], origins: [] }, 1000).cookies).toHaveLength(2));
it("drops a left-out saved cookie that has expired", () =>
  expect(mergeSessionState({ cookies: [c("old", "x", 500)], origins: [] }, { cookies: [], origins: [] }, 1000).cookies).toEqual([]));
it("same name on another path is another cookie", () =>
  expect(mergeSessionState({ cookies: [c("sid", "a", -1, ".acme.example", "/a")], origins: [] }, { cookies: [c("sid", "b")], origins: [] }, 1000).cookies).toHaveLength(2));
it("keeps the saved origins when the fresh state has none", () =>
  expect(mergeSessionState({ cookies: [], origins: [{ origin: "https://acme.example", localStorage: [] }] }, { cookies: [], origins: [] }, 1000).origins).toHaveLength(1));
it("uses the fresh origins when there are some", () => { /* fresh origins win, saved ones are not appended */ });
it("sameSessionState ignores cookie order", () =>
  expect(sameSessionState({ cookies: [c("a", "1"), c("b", "2")], origins: [] }, { cookies: [c("b", "2"), c("a", "1")], origins: [] })).toBe(true));
it("sameSessionState sees a changed value", () =>
  expect(sameSessionState({ cookies: [c("a", "1")], origins: [] }, { cookies: [c("a", "2")], origins: [] })).toBe(false));
```

- [ ] **Step 2:** Run `npx vitest run packages/supplier-session/src/merge.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement both functions in `merge.ts`.** Key a cookie by `${domain}\t${path}\t${name}`. `expires === -1` or missing means no expiry. Compare by sorting each cookie list by key, then `JSON.stringify`.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(supplier-session): merge refreshed cookies into a saved session`.

### Task 2: The browser service returns the refreshed state

**Files:**
- Modify: `services/browser/src/verify.ts` (`VerifyOutcome`, `checkPage`, `verifyPage`)
- Modify: `services/browser/src/capture.ts` (`capturePage`)
- Modify: `services/browser/src/profile-check.ts` (`checkHeld`, `inProfile`)
- Modify: `services/browser/src/plain-window.ts` (export `cookieStore`)
- Test: `services/browser/test/service.browser.test.ts`, `services/browser/test/profile-check.browser.test.ts`, `services/browser/src/server.test.ts`

**Interfaces:**
- Produces: `VerifyOutcome` gets `state?: SessionState`, so `CheckPageOutcome` and `CaptureOutcome` (which extend it) get it too. Set only when `result === "ok"`.

- [ ] **Step 1: Write the failing tests.**
  - `service.browser.test.ts`: the fixture site sets a new cookie `fresh=1` on the product page. `verify`, `check-page` and `capture` against it return `state.cookies` containing `fresh`. Against the fixture login page, `state` is `undefined`.
  - `profile-check.browser.test.ts`: the same two cases for profile mode, both `verify` (cookies read from the file after quit) and `checkPage` (cookies read over the debugging channel). After an `ok` check, the profile's `seeded` file equals `cookieHash(outcome.state.cookies)`.
  - `server.test.ts`: when `verify` returns a `state`, the log lines contain no cookie value.
- [ ] **Step 2:** Run `npx vitest run --no-file-parallelism services/browser/test/service.browser.test.ts services/browser/test/profile-check.browser.test.ts` and `npx vitest run services/browser/src/server.test.ts`. Expected: the new cases FAIL.
- [ ] **Step 3: Implement.**
  - Headless (`checkPage`, `capturePage`): before `context.close()`, if `outcome.result === "ok"`, set `outcome.state = await context.storageState()`. `verifyPage` passes `state` through.
  - Profile `checkHeld`: after `b.stop()`, when the final result is `ok`, set `state = { cookies: readCookies(cookieStore(profile)), origins: [] }` and write `cookieHash(state.cookies)` to the `seeded` marker.
  - Profile `inProfile`: give `run` a way to read the cookies before `cdp.close()`. The simplest is an extra `context` argument. When the result is `ok`, set `state = { cookies: await context.cookies(), origins: [] }`. After `b.stop()`, update the marker the same way.
- [ ] **Step 4:** Run the commands from Step 2. Expected: PASS, with the existing cases still passing.
- [ ] **Step 5:** Commit: `feat(browser): return the refreshed session after a logged-in check`.

### Task 3: The browser client passes the state through

**Files:**
- Modify: `packages/browser-client/src/client.ts`
- Test: `packages/browser-client/src/client.test.ts`

**Interfaces:**
- Consumes: the Task 2 JSON field `state`.
- Produces: `state?: SessionState` on the `ok: true` branch of `VerifyOutcome`, `CheckPageOutcome` and `CaptureOutcome`.

- [ ] **Step 1: Write the failing tests:** for each of `verify`, `checkPage` and `capture`, a 200 body with a valid `state` gives `outcome.state` equal to it. A body whose `state` fails `isSessionState` (for example `{ cookies: "x" }`) gives `state` `undefined` and still `ok: true`.
- [ ] **Step 2:** Run `npx vitest run packages/browser-client`. Expected: FAIL.
- [ ] **Step 3:** In each of the three parsers add `...(isSessionState(j.state) ? { state: j.state } : {})`.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(browser-client): pass the refreshed session through`.

### Task 4: Database: load with IV, refresh by compare-and-swap, early-check marker

**Files:**
- Modify: `packages/db/src/supplier-session-repository.ts`
- Modify: `packages/db/src/schema.ts` (add `sessionPrecheckFor: timestamp("session_precheck_for", { withTimezone: true })` to `suppliers`)
- Modify: `packages/db/src/supplier-repository.ts` (`SupplierRecord.sessionPrecheckFor: Date | null`, new method)
- Create: `packages/db/drizzle/0015_*.sql` via `npm run db:generate -w @stock-monitor/db`
- Test: the existing supplier-session and supplier repository integration tests in `packages/db/test/`

**Interfaces:**
- Produces:
  - `supplierSessions.refresh(supplierId: string, expectedIv: string, sealed: Encrypted, state: State): Promise<boolean>`. It updates the ciphertext, iv, tag, key id, `cookie_count`, `domains`, `size_bytes` and `last_verified_at = now()`, only `where supplier_id = $1 and state_iv = expectedIv`. It never changes `saved_at`. It returns true when a row changed.
  - `suppliers.markPrecheckQueued(id: string, forRun: Date): Promise<void>`.

- [ ] **Step 1: Write the failing tests:**
  - `refresh` with the current IV returns true. The new sealed value reads back from `getSealed`, `savedAt` is unchanged, and `lastVerifiedAt` is set.
  - `refresh` after a `save` (a new login) with the old IV returns false, and the row still holds the new login.
  - `markPrecheckQueued` then `get` shows `sessionPrecheckFor` equal to `forRun`, to the millisecond.
- [ ] **Step 2:** Run `npx vitest run packages/db/test/supplier-session-repository.int.test.ts packages/db/test/supplier-repository.int.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement both methods. Then generate the migration and read the generated SQL: it must be one `ALTER TABLE "suppliers" ADD COLUMN "session_precheck_for" timestamp with time zone;`.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(db): refresh a saved session in place and mark early checks`.

### Task 5: The worker saves refreshed sessions

**Files:**
- Create: `apps/worker/src/session-refresh.ts`
- Modify: `apps/worker/src/supplier-verify.ts`, `apps/worker/src/mapping-link-check.ts`, `apps/worker/src/extraction-check.ts`
- Test: `apps/worker/test/session-refresh.int.test.ts` (new), plus new cases in `supplier-verify.int.test.ts`, `mapping-link-check.int.test.ts` and `extraction-check.int.test.ts`

**Interfaces:**
- Consumes: Task 1 `mergeSessionState` and `sameSessionState`, Task 3 `outcome.state`, Task 4 `refresh` and `markVerified`.
- Produces: `saveRefreshedSession(deps: { supplierSessions; audit; key: Buffer }, supplierId: string, loaded: { sealed: Encrypted; state: SessionState }, fresh: SessionState | undefined): Promise<"saved" | "unchanged" | "stale" | "none">`.
  - `fresh` undefined gives `"none"` and no write.
  - A merge equal to `loaded.state` calls `markVerified` and gives `"unchanged"`.
  - Otherwise it reseals with `sealSessionState(merged, key, loaded.sealed.keyId)` and calls `refresh(supplierId, loaded.sealed.iv, …)`. False gives `"stale"`. True records audit `supplier.session_refreshed` with details `{ cookieCount }` and gives `"saved"`.

- [ ] **Step 1: Write the failing tests:**
  - `session-refresh.int.test.ts` covers all four outcomes. For `"saved"`, the audit row's `details` is exactly `{ cookieCount: n }` and has no cookie name or value.
  - `supplier-verify.int.test.ts`: a fake browser's `ok` with `state` replaces the stored session. `login_required` with a `state` (a buggy service) stores nothing.
  - `mapping-link-check.int.test.ts`: an `ok` link check with `state` refreshes the session.
  - `extraction-check.int.test.ts`: in a supplier run of 3 pages, `refresh` is called once, at the end, with the last `ok` page's state. A run where the test calls `supplierSessions.save` (a reconnect) between pages ends with the reconnect's session stored.
- [ ] **Step 2:** Run `npx vitest run apps/worker/test`. Expected: the new cases FAIL.
- [ ] **Step 3: Implement.**
  - Each caller keeps the `sealed` value it already loads beside the unsealed `state`, so it can pass `loaded`.
  - `supplier-verify` and `mapping-link-check` call the helper after an `ok` outcome. In `supplier-verify`, the helper replaces the existing `supplierSessions.markVerified` call on that path, and the other calls (suppliers, notifications, audit `ok`) stay.
  - `extraction-check`: add `fresh?: SessionState` and `loaded` to `Visit`. The single-mapping path calls the helper after its visit. The supplier run calls it once after the visits loop, with the last visit that has `fresh`.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(worker): keep supplier sessions fresh after logged-in checks`.

### Task 6: Early login check before each run

**Files:**
- Modify: `packages/scheduling/src/schedule.ts` (constant and decision)
- Modify: `packages/queue/src/jobs.ts` (`supplier.session.verify` gets optional `early: z.literal(true)`, still `.strict()`)
- Modify: `apps/worker/src/scheduling-tick.ts`, `apps/worker/src/supplier-verify.ts` (handle `early`)
- Test: `packages/scheduling/src/schedule.test.ts`, `packages/queue/src/jobs.test.ts`, `apps/worker/test/scheduling-tick.int.test.ts`, `apps/worker/test/supplier-verify.int.test.ts`

**Interfaces:**
- Consumes: Task 4 `sessionPrecheckFor`, `markPrecheckQueued`, and `facts().lastVerifiedAt`.
- Produces: `SESSION_CHECK_LEAD_MINUTES = 120` and `needsSessionPrecheck(input: { now: Date; nextCheckAt: Date | null; window: Window; lastVerifiedAt: Date | null; precheckFor: Date | null }, timeZone: string): boolean`. It is true only when all of these hold:
  - `nextCheckAt > now`
  - `nextCheckAt - now <= 120 min`
  - `insideWindow(now, window, timeZone)`
  - `lastVerifiedAt` is null or earlier than `nextCheckAt - 120 min`
  - `precheckFor?.getTime() !== nextCheckAt.getTime()`

- [ ] **Step 1: Write the failing tests:**
  - `schedule.test.ts`: one case per condition above, each false while the others hold. One all-true case.
  - `jobs.test.ts`: `{ supplierId, early: true }` parses. `{ supplierId, early: false }` and `{ supplierId, early: "yes" }` throw. The existing "refuses anything else" case still passes.
  - `scheduling-tick.int.test.ts`:
    - A supplier whose run is 90 minutes away, never verified, inside its window: one `supplier.session.verify` `{ supplierId, early: true }` is queued.
    - The next tick queues none.
    - A supplier inside its quiet hours: none.
    - A supplier with `lastVerifiedAt` 30 minutes ago and its run 90 minutes away: none.
    - A supplier that fails the stock gate (`needs_reconnect`): none.
  - `supplier-verify.int.test.ts`:
    - With `early: true`, an `unknown` result writes audit `supplier.session_checked` with `{ result: "unknown" }`, but no notification and no status change.
    - With `early: true`, `login_required` raises the notice as today.
    - Without `early`, `unknown` behaves exactly as today.
- [ ] **Step 2:** Run `npx vitest run packages/scheduling packages/queue` and `npx vitest run apps/worker/test`. Expected: the new cases FAIL.
- [ ] **Step 3: Implement.**
  - In `runTick`, after a supplier passes `stockGate`, read `supplierSessions.facts(id)`. If `needsSessionPrecheck(...)`, call `markPrecheckQueued(id, nextCheckAt)` first, then `queue.enqueue("supplier.session.verify", { supplierId: id, early: true }, { retryLimit: 0 })`. Log a warning on an enqueue failure and carry on.
  - `verifySupplierSession` takes `options?: { early?: boolean }`. In its `default:` case, when `early && result === "unknown"`, record the audit and return `{ kind: "needs_attention", result }` without calling `raiseNeedsAttention`.
- [ ] **Step 4:** Run the commands from Step 2. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(scheduling): check the supplier login two hours before each run`.

### Task 7: Whole-branch check, docs, PR

**Files:**
- Modify: `docs/status.md` (one row of notes under "supplier-session")

- [ ] **Step 1:** Run `npm run check` and `npm run test:browser`. Expected: all green.
- [ ] **Step 2:** Add the design and this plan to the commit. Add one line to `docs/status.md`: refreshed cookies are saved after logged-in checks, and the login is checked 2 hours before each run.
- [ ] **Step 3:** Commit: `docs: session refresh design, plan and status`.
- [ ] **Step 4:** Push `feature/session-refresh` and open a PR into `develop` with a detailed description. Merge on green, per the owner's workflow.
- [ ] **Step 5 (owner, after deploy):** Pick one pilot supplier. Note the session's `last_verified_at`, then run "Check session". Expected: `last_verified_at` moves forward. If that supplier extends sessions, a later "Check session" a day after its old expiry still finds the page logged in.
