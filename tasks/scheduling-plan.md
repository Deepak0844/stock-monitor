# Implementation Plan: scheduling

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (native) or superpowers:subagent-driven-development. Steps use `- [ ]` so progress shows.

**Goal:** Check each supplier on its own at an interval the owner sets, one run per supplier, with run records, progress, quiet hours, stop-and-backoff on failure, and "Check now" that fits the same run model.

**Architecture:** Pure logic in a new `packages/scheduling` (next-check time, quiet hours, backoff, due selection, stale test). A once-a-minute `scheduling.tick` job (pg-boss cron) starts due runs through the same path as "Check now": create a `check_runs` row (a partial unique index allows one running row per supplier), then enqueue the existing `extraction.checks` job with the run id. The stock checker records progress on the run row and applies the stop rules.

**Tech Stack:** TypeScript, Fastify, Drizzle + PostgreSQL, pg-boss 12 (`boss.schedule`), Vitest + Testcontainers, React, Playwright. No new dependency (time zones use `Intl.DateTimeFormat`).

**Spec:** `SPEC-scheduling.md` (approved 2026-11-10). Map: `CAPABILITY-MAP.md`.

Repo is public: no supplier names or domains in code, fixtures or docs. Never touch the owner's `.env`. Use npm. One branch from `develop` and one PR per task (pure-logic tasks may share one), merge only after `gh pr checks` is all green. Never `gh pr merge --delete-branch` while a worktree holds the branch. No Claude attribution in commits or PRs. Work in a worktree, never the owner's folder.

## Global Constraints (spec values, verbatim)
- Intervals (minutes): `60`, `180`, `360`, `720`, `1440`. Default when turned on: `1440`. Off = null.
- Spread: up to **10%** of the interval, added to the next check time.
- Quiet-hours window: default **07:00 to 22:00** in the owner's timezone; the owner may set all day (null). A window may cross midnight.
- Tick every minute. At most **2** runs at once across suppliers. One running run per supplier.
- Stop at once on `login_required`, `captcha`, `blocked`. Never retry those. Unreachable: stop the run after **3 pages in a row**; backoff **15 min, 1 h, 4 h**, then the normal interval; success resets. Backoff never shorter than the supplier's `checkPauseSeconds`.
- Stale: last check older than **2x** the interval.
- Run rows kept **30 days**. No page text, address or session data in a run row, log, audit event or job. Job payloads are ids only.
- Gate unchanged: connected, running, `granted`, active rules. A supplier failing it is skipped and its `next_check_at` is **not** moved.
- **Correction to the spec's assumption 8:** the API and worker have no timezone setting today (`TZ` exists only for the browser container). This plan adds one setting `APP_TIMEZONE` (IANA name, default `UTC`), which compose fills from `BROWSER_TIMEZONE`.

## Review Focus (spec implies, tests pin it in the named task)
1. Two ticks at once, or a tick during a manual run, must never start two runs for one supplier (Task 2 index, Task 5).
2. A window that crosses midnight (22:00 to 06:00) and a daylight-saving change must still give a time inside the window (Task 1).
3. Worker killed mid-run must not leave a run "running" forever and block the supplier (Task 5).
4. Supplier deleted, paused or made not-allowed while a run is queued or running: the run ends without visiting, no crash, runs deleted with the supplier (Tasks 2, 4).
5. A supplier with no enabled links: the run finishes at once, counts zero, next check still moves (Task 4).
6. Interval changed or turned off while a run is going: the running run finishes, the new interval applies after it (Task 4, 6).

## Files
- Create `packages/scheduling/{package.json,src/index.ts,src/schedule.ts,src/schedule.test.ts}`.
- Create `packages/db/drizzle/0009_scheduling.sql`, `packages/db/src/check-run-repository.ts`.
- Modify `packages/db/src/{schema.ts,supplier-repository.ts,index.ts}`, `packages/queue/src/{jobs.ts,queue.ts}`, `packages/shared` config (`APP_TIMEZONE`), `docker-compose.yml`.
- Create `apps/worker/src/scheduling-tick.ts` (+ test). Modify `apps/worker/src/{extraction-check.ts,supplier-verify.ts,worker.ts,index.ts}`.
- Create `apps/api/src/routes/schedule.ts`. Modify `apps/api/src/routes/{stock-checks.ts,suppliers.ts}`, `apps/api/src/app.ts`.
- Modify `apps/web/src/pages/{SupplierFormPage.tsx,SuppliersPage.tsx,MappingsPage.tsx}`; create `apps/web/src/components/{SchedulePanel.tsx,RunHistory.tsx}`.
- Create `e2e/scheduling.spec.ts`; modify `docs/deployment.md`.

## Dependency graph
```
1 pure ─┐
2 db ───┼─ 4 checker run + stop rules ─ 5 tick + reap ─┐
3 queue ┘                                              ├─ 7 web ─ 8 e2e + docs
                          2,3,4 ─ 6 API ───────────────┘
```

---

### Task 1: Pure scheduling logic

**Files:** Create `packages/scheduling/package.json` (same shape as `packages/extraction/package.json`, no dependencies), `src/schedule.ts`, `src/index.ts`; Test `src/schedule.test.ts`.

**Interfaces — Produces:**
```ts
export const INTERVALS = [60, 180, 360, 720, 1440] as const;
export type Window = { start: string; end: string } | null; // "HH:MM" local, null = all day
export const DEFAULT_WINDOW: { start: "07:00"; end: "22:00" };
export function insideWindow(at: Date, window: Window, timeZone: string): boolean;
/** Earliest time >= `from` that is inside the window (from itself if already inside). */
export function intoWindow(from: Date, window: Window, timeZone: string): Date;
/** now + interval + spread (spread = rand() * 10% of interval), then intoWindow. */
export function nextCheckAt(now: Date, intervalMinutes: number, window: Window, timeZone: string, rand?: () => number): Date;
/** failureCount 1,2,3+ -> 15, 60, 240 minutes; never below pauseSeconds. Returns milliseconds. */
export function backoffMs(failureCount: number, pauseSeconds: number): number;
export function isStale(lastCheckedAt: Date | null, intervalMinutes: number | null, now: Date): boolean;
export type DueCandidate = { id: string; nextCheckAt: Date };
/** Due ones (nextCheckAt <= now, inside the window), oldest first, at most `max - running`. */
export function pickDue(candidates: (DueCandidate & { window: Window })[], now: Date, running: number, max: number, timeZone: string): string[];
```

- [ ] **Step 1: Failing tests** in `schedule.test.ts` (fixed dates, fake `rand`): `insideWindow` true at 07:00 and 21:59, false at 22:00 and 06:59 (`Asia/Kolkata`); crossing midnight window 22:00-06:00 true at 23:30 and 05:00, false at 12:00; `null` window always true; `intoWindow` at 23:00 with 07:00-22:00 returns next day 07:00 local; `nextCheckAt` with `rand=()=>1` on 1440 adds exactly 1440+144 minutes then fits the window; with `rand=()=>0` adds 1440; a DST-change date in `America/New_York` (2026-03-08) still lands inside 07:00-22:00; `backoffMs(1,10)=900_000`, `(2,10)=3_600_000`, `(3,10)=(9,10)=14_400_000`, `backoffMs(1, 2000)` is at least 2_000_000; `isStale` false when `lastCheckedAt` is null or interval is null, true at 2x+1 minute, false at exactly 2x; `pickDue` returns oldest first, skips not-due and outside-window, respects `max - running` (0 when `running >= max`).
- [ ] **Step 2:** Run `npx vitest run packages/scheduling` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the functions above in `schedule.ts`. Local time by `Intl.DateTimeFormat(..., {timeZone, hourCycle:"h23", hour, minute})`; `intoWindow` steps forward in 15-minute increments (max 48 h) so DST needs no special case.
- [ ] **Step 4:** Run the same command — Expected: PASS. Run `npm run check`.
- [ ] **Step 5: Commit** `feat(scheduling): pure schedule logic`.

---

### Task 2: Database — runs and supplier columns

**Files:** Create `packages/db/drizzle/0009_scheduling.sql` (use the repo's migration generator the way 0008 was made), `packages/db/src/check-run-repository.ts`; Modify `schema.ts`, `supplier-repository.ts`, `index.ts`; Test `check-run-repository.test.ts` and extend the supplier repository test.

**Interfaces — Produces:**
```ts
// schema: check_runs(id uuid pk, supplier_id uuid not null references suppliers on delete cascade, trigger text check in ('scheduled','manual'),
//   started_at, ended_at null, links_total int, links_done int, in_stock int, out_of_stock int, cannot_tell int,
//   outcome text check in ('running','finished','stopped','failed'), stop_reason text null)
// unique index check_runs_one_running on (supplier_id) where outcome = 'running'
// suppliers gains: check_interval_minutes int null (check in 60,180,360,720,1440), check_window_start text null, check_window_end text null
//   (both null or both set), next_check_at timestamptz null, failure_count int not null default 0
export type CheckRun = { id: string; supplierId: string; trigger: "scheduled" | "manual"; startedAt: Date; endedAt: Date | null; linksTotal: number; linksDone: number; inStock: number; outOfStock: number; cannotTell: number; outcome: "running" | "finished" | "stopped" | "failed"; stopReason: string | null };
export function createCheckRunRepository(db): {
  start(supplierId: string, trigger: "scheduled" | "manual", linksTotal: number): Promise<CheckRun | null>; // null when one is already running
  progress(id: string, counts: { linksDone: number; inStock: number; outOfStock: number; cannotTell: number }): Promise<void>;
  end(id: string, outcome: "finished" | "stopped" | "failed", stopReason: string | null): Promise<void>;
  running(): Promise<CheckRun[]>;
  current(supplierId: string): Promise<CheckRun | null>;
  recent(supplierId: string, limit: number): Promise<CheckRun[]>;
  stopAllRunning(reason: string): Promise<number>;
  purge(days: number): Promise<number>;
};
// supplier repository gains:
//   setSchedule(id, { intervalMinutes: number | null; window: Window; nextCheckAt: Date | null }): Promise<SupplierRecord | null>
//   recordRunEnd(id, { nextCheckAt: Date; failureCount: number }): Promise<void>
//   scheduled(): Promise<SupplierRecord[]>   // intervalMinutes not null
// SupplierRecord gains: checkIntervalMinutes, checkWindowStart, checkWindowEnd, nextCheckAt, failureCount
```

- [ ] **Step 1: Failing tests:** `start` twice for one supplier returns a row then `null`; after `end`, `start` works again; `start` on two suppliers works; `progress` and `end` update counts and `ended_at`; `stopAllRunning("restarted")` sets outcome `stopped` with that reason and returns the count; `purge(30)` deletes only runs ended more than 30 days ago; deleting a supplier deletes its runs; `setSchedule` rejects an interval not in the list and a half-set window (DB check); `recordRunEnd` stores both values.
- [ ] **Step 2:** Run `npx vitest run packages/db` — Expected: FAIL.
- [ ] **Step 3: Implement** schema, migration, repositories. `start` does insert and treats the unique-violation as `null`. Existing `truncate` statements in tests that list `suppliers` already use `cascade`.
- [ ] **Step 4:** Run the same — Expected: PASS. Run `npm run check`.
- [ ] **Step 5: Commit** `feat(db): check runs and supplier schedule columns`.

---

### Task 3: Queue — cron schedule and run id

**Files:** Modify `packages/queue/src/jobs.ts`, `queue.ts`; Test `jobs.test.ts`; Modify `packages/shared` config and `docker-compose.yml`.

**Interfaces — Produces:**
```ts
// jobs: "scheduling.tick": z.object({}).strict();  "extraction.checks": z.object({ supplierId: z.uuid(), runId: z.uuid() }).strict()
// Queue gains: schedule(name: JobName, cron: string): Promise<void>   // boss.schedule(name, cron, {}), idempotent
// config: timezone: string (APP_TIMEZONE, default "UTC", must be a valid IANA name)
```

- [ ] **Step 1: Failing tests:** `parseJob("scheduling.tick", {})` passes and `{x:1}` throws; `parseJob("extraction.checks", {supplierId})` throws (runId required); config rejects `APP_TIMEZONE=Mars/Base`.
- [ ] **Step 2:** Run `npx vitest run packages/queue packages/shared` — Expected: FAIL.
- [ ] **Step 3: Implement.** `schedule` calls `boss.schedule`. Validate the zone with `new Intl.DateTimeFormat("en", { timeZone })` in config. In `docker-compose.yml` give `api` and `worker` `APP_TIMEZONE: ${BROWSER_TIMEZONE:-UTC}`. Update the existing callers of `enqueue("extraction.checks", ...)` and their tests in Task 6 (this task leaves the API tests failing only if run in isolation; do Tasks 3 and 6 call-site edits together if CI requires).
- [ ] **Step 4:** Run the same — Expected: PASS.
- [ ] **Step 5: Commit** `feat(queue): cron schedule, scheduling.tick, run id on supplier checks`.

---

### Task 4: Checker records the run and applies stop rules

**Files:** Modify `apps/worker/src/extraction-check.ts`, `supplier-verify.ts`; Test `extraction-check.test.ts` (extend; update existing supplier-run tests for the new signature).

**Interfaces — Consumes:** Tasks 1-3. **Produces:**
```ts
// StockCheckDeps gains: checkRuns: ReturnType<typeof createCheckRunRepository>; timezone: string
// supplier-verify.ts exports: needsAttention(deps: Pick<SupplierVerifyDeps,"suppliers"|"notifications"|"audit">, supplier: {id: string; name: string}, result: SessionReason): Promise<void>
//   (the existing markNeedsAttention + notification + audit, moved out of verifySupplierSession, behaviour unchanged)
// checkSupplierStock(deps, supplierId: string, runId: string): Promise<StockRunOutcome>
// StockRunOutcome "done" gains: stopped: { reason: "login_required" | "captcha" | "blocked" | "unreachable" } | null
```

Behaviour: the run row's `links_total` is set by whoever started it; `checkSupplierStock` calls `checkRuns.progress` after each page and `checkRuns.end` at the end. After each page, count the answer (`in_stock`, `out_of_stock`, else `cannot_tell`). Stop rules from the spec table: `login_required`, `captcha`, `blocked` end the run at once with outcome `stopped`, call `needsAttention` (blocked/captcha set Blocked, login sets Needs reconnecting), set `failure_count` to 0 and leave `next_check_at` alone (the gate now refuses the supplier). 3 unreachable pages in a row end the run `stopped` with reason `unreachable`, `failure_count += 1`, `next_check_at = now + backoffMs(failure_count, pause)`. A run that ends normally sets `failure_count = 0` and `next_check_at = nextCheckAt(now, interval, window, timezone)` when the supplier has an interval (this also covers a manual run). A gate refusal mid-run (supplier paused, permission revoked, deleted) ends the run `stopped` with reason `supplier_not_ready`, no visit. Any thrown error ends the run `failed`, `failure_count += 1`, backoff as unreachable, audited as `check_run.failed` with a code only. The supplier-wide-change and recipe notification logic stays as is.

- [ ] **Step 1: Failing tests** (fake browser, fake clock, `sleep` no-op): in/out/cannot-tell counts match the observations; progress is updated after each page; `login_required` on page 2 of 5 stops with 2 visits and raises the reconnect notification; `captcha` and `blocked` set Blocked and are never retried (assert exactly one visit); 3 unreachable in a row stops, `failure_count` 1 and `next_check_at` = now + 15 min; second failed run gives 60 min, third 240 min, fourth 240 min; a following success resets `failure_count` to 0 and sets next check one interval (plus spread) later; supplier with no enabled links ends `finished` with 0 and still moves `next_check_at`; supplier paused between pages ends `stopped` `supplier_not_ready`; a thrown browser error ends `failed`; no run row, log or audit detail contains the page URL or title (assert on serialized rows).
- [ ] **Step 2:** Run `npx vitest run apps/worker` — Expected: FAIL.
- [ ] **Step 3: Implement** as described; keep `checkStock` (one link) unchanged. Reuse the `STATUS`/`MESSAGES` tables by moving them with `needsAttention`.
- [ ] **Step 4:** Run the same — Expected: PASS. Run `npm run check`.
- [ ] **Step 5: Commit** `feat(worker): supplier check runs, stop rules, backoff`.

---

### Task 5: Tick and restart reaping

**Files:** Create `apps/worker/src/scheduling-tick.ts`, `scheduling-tick.test.ts`; Modify `worker.ts`, `index.ts`.

**Interfaces — Produces:**
```ts
export type TickDeps = { suppliers; supplierSessions; recipes; mappings; checkRuns; queue: Pick<Queue,"enqueue">; audit; logger; timezone: string; now?: () => Date };
export async function runTick(deps: TickDeps): Promise<{ started: string[]; skipped: { supplierId: string; reason: SkipReason }[] }>;
export async function reapStaleRuns(deps: Pick<TickDeps,"checkRuns"|"audit"|"logger">): Promise<number>;
// worker.ts: WorkerDeps gains scheduling?: Omit<TickDeps,"logger">; registers queue.work("scheduling.tick", ...) and queue.schedule("scheduling.tick", "* * * * *")
```

Behaviour: `runTick` loads `suppliers.scheduled()`, drops those that fail the gate (`whyNotChecked` plus active recipe; recorded in `skipped`, `next_check_at` untouched), calls `pickDue(..., running = (await checkRuns.running()).length, max = 2)`, then for each: `checkRuns.start(id, "scheduled", enabledLinkCount)`; if `null`, skip; else `queue.enqueue("extraction.checks", { supplierId, runId }, { expireInSeconds, retryLimit: 0 })` (same duration formula as the manual route; if enqueue throws, `end(run.id, "failed", "not_queued")`). Audit `check_run.started`. `reapStaleRuns` runs once at worker start and calls `checkRuns.stopAllRunning("restarted")`; the tick also stops any run whose `started_at` is older than its expiry plus 5 minutes. The tick also calls `checkRuns.purge(30)`. A supplier with a `next_check_at` of null and an interval set is treated as due now (first tick after turning on is not needed, the API sets it, but a restored backup might not).

- [ ] **Step 1: Failing tests** (real DB, fake queue that records, fake clock): due supplier starts and enqueues once; not-due, outside-window, paused, no-permission, no-session and no-recipe suppliers start nothing and keep `next_check_at`; three due suppliers with `max 2` start two (oldest first); a supplier already running is not started again; **two `runTick` calls awaited with `Promise.all` start exactly one run for one supplier**; a running run older than its expiry is stopped `restarted`; `reapStaleRuns` ends every running run with `stopped`/`restarted` and the next tick starts it again only once `next_check_at` has passed; downtime: `next_check_at` three days ago starts one run, and after it the next check is one interval ahead, not three runs.
- [ ] **Step 2:** Run `npx vitest run apps/worker/src/scheduling-tick.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** and wire into `worker.ts`/`index.ts` (`timezone: config.timezone`, `reapStaleRuns` before `queue.work`).
- [ ] **Step 4:** Run the same — Expected: PASS. Run `npm run check`.
- [ ] **Step 5: Commit** `feat(worker): scheduling tick and restart reaping`.

---

### Task 6: API — schedule, runs, manual runs

**Files:** Create `apps/api/src/routes/schedule.ts` (+ test); Modify `routes/stock-checks.ts`, `routes/suppliers.ts`, `app.ts`.

**Interfaces — Produces:**
- `PUT /api/suppliers/:id/schedule` body `{ intervalMinutes: 60|180|360|720|1440|null, window: { start: "HH:MM", end: "HH:MM" } | null }` (strict Zod) → 200 supplier. Sets `next_check_at = nextCheckAt(now, ...)` (null when off), resets `failure_count` to 0. 404 unknown supplier; 400 bad values; audit `supplier.schedule_set` with the interval and window only.
- `GET /api/suppliers/:id/runs` → `{ runs: CheckRun[] }` (last 30 days, newest first, max 30). `GET /api/suppliers/:id/runs/current` → `{ run: CheckRun | null }`.
- `POST /api/suppliers/:id/check-stock` now: gate as today, `checkRuns.start(id, "manual", links)`; `null` → 409 `run_in_progress` "A check for this supplier is already running."; enqueue `{ supplierId, runId }`; response unchanged plus `runId`. If enqueue fails, end the run `failed`/`not_queued`.
- Supplier JSON gains `checkIntervalMinutes`, `checkWindowStart`, `checkWindowEnd`, `nextCheckAt` and `scheduleStatus: "off" | "waiting" | "running" | { notChecked: CheckGateReason | "no_recipe" }` (derived server-side, one place).

- [ ] **Step 1: Failing tests** (`inject()`, signed-in owner; fake queue): PUT stores values and next check is within interval+10%; PUT `intervalMinutes: 45` → 400; null clears `next_check_at`; changing interval during a run leaves the run alone; POST check-stock while running → 409 `run_in_progress`; two concurrent POSTs → one 202, one 409; manual run row has trigger `manual`; GET runs returns counts and no addresses; unauthenticated → 401 on all; `scheduleStatus` is `{notChecked: "no_permission"}` for a supplier not recorded as allowed.
- [ ] **Step 2:** Run `npx vitest run apps/api` — Expected: FAIL.
- [ ] **Step 3: Implement.** Update the existing `check-stock` tests for the new payload.
- [ ] **Step 4:** Run the same — Expected: PASS. Run `npm run check`.
- [ ] **Step 5: Commit** `feat(api): schedule, runs and manual run records`.

---

### Task 7: Screens

**Files:** Create `components/SchedulePanel.tsx`, `components/RunHistory.tsx` (+ tests); Modify `SupplierFormPage.tsx`, `SuppliersPage.tsx`, `MappingsPage.tsx`, `api.ts`.

Behaviour (plain words, existing patterns in `styles.css`): **Supplier edit page**: "Automatic checks" panel: a select (Off, Every hour, Every 3 hours, Every 6 hours, Every 12 hours, Daily), "Only between" two time inputs with an "All day" checkbox (default 07:00 to 22:00), "Next check: <time>", and when `scheduleStatus.notChecked` is set the plain reason (reuse the gate messages). Saving calls the PUT and shows the result. **Suppliers list**: a line "Every day, next at 14:10" / "Automatic checks off" / "Not being checked: <reason>"; while a run is running, "Checking 12 of 40 links", polled every 5 s from `runs/current` (stop polling when none). After it ends: "Checked 40 links, 3 cannot tell" with the time. **Links page**: "Not checked recently" marker using the same `isStale` rule (import from `@stock-monitor/scheduling`). **Run history**: the last 30 runs in a table: when, "Scheduled"/"By you", counts, stop reason in words.

- [ ] **Step 1: Failing tests** (Testing Library, mocked api): panel saves the chosen interval and window; "All day" sends `window: null`; unavailable-reason text shows; list shows progress "Checking 12 of 40 links" then the summary; stale marker appears for a link last checked 3 days ago on a daily supplier and not for 1 day; history shows stop reasons ("The supplier asked you to log in again", "The supplier could not be reached", "The app restarted"); the controls have labels and no axe violations.
- [ ] **Step 2:** Run `npx vitest run apps/web` — Expected: FAIL.
- [ ] **Step 3: Implement** the components and wiring.
- [ ] **Step 4:** Run the same — Expected: PASS. Run `npm run check`.
- [ ] **Step 5: Commit** `feat(web): automatic checks panel, progress, stale marker, run history`.

---

### Task 8: End to end and docs

**Files:** Create `e2e/scheduling.spec.ts` (own Playwright projects `scheduling-desktop` / `scheduling-phone`, after the extraction ones, serial); Modify `e2e/control.ts` (a `control.tick()` hook that runs one `runTick` against the e2e stack), `playwright.config.ts`, `docs/deployment.md` (section "Automatic checks"), `CAPABILITY-MAP.md` (mark scheduling built).

- [ ] **Step 1: Failing journeys** against the fake supplier: set daily + 07:00-22:00, see "Next check"; `control.tick()` with the clock forced past next check runs one check and the page shows "Checked N links"; Check now shows "Checking x of N" then the summary; a second Check now during a run shows the plain "already running" message; the fake supplier's `/login-redirect` mid-run stops the run, shows the reconnect notice on the Dashboard, and a second `control.tick()` starts nothing; a supplier with no recorded permission shows "Not being checked" and nothing runs; axe scan of the panel and history on desktop and phone; no-secrets scan of the run history response.
- [ ] **Step 2:** Run `npm run test:e2e -- --project=scheduling-desktop` — Expected: FAIL.
- [ ] **Step 3: Implement** the hook and fixtures; write the docs section in plain words (what to set, quiet hours, what stops a run, what to do after a stop, that `APP_TIMEZONE` follows `BROWSER_TIMEZONE`).
- [ ] **Step 4:** Run the e2e projects — Expected: PASS. Run `npm run check`, `npm run test:browser`.
- [ ] **Step 5: Commit** `test(e2e): scheduling journeys and guide`.

---

## Spec coverage
Criteria 1 (Tasks 6, 7), 2 (5, 4), 3 (5, 6), 4 (2, 5, 6), 5 (4), 6 (5), 7 (4, 7), 8 (1, 7), 9 (2, 4, 8), 10 (all). Quiet hours (1, 5, 7). Pilot-only turn-on needs no code: schedules default off and the owner turns it on for one supplier.

## Not covered on purpose
Real-supplier validation (documented manual step, needs the owner's pilot permission recorded first). Proposals and Shopify writes (next module).
