# Keep Login Alive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A per-supplier keep-alive that visits the supplier with the saved session inside its check window.

**Architecture:** The tick queues the existing `supplier.session.verify` job with `keepAlive: true`. A pure due-function
lives in `@stock-monitor/scheduling`, and two columns are added to `suppliers`.

**Spec:** `docs/superpowers/specs/2026-11-18-keep-alive-design.md`

## Global Constraints

- `KEEP_ALIVE_CHOICES = [15, 30, 45, 60, 120]`. Off is null.
- The spread is ±10%.
- Never outside the window, never for a supplier that `whyNotChecked` refuses, and never while a run is going.
- No supplier names in repo files. No Claude attribution lines in commits.

## Review Focus

- A keep-alive visit that cannot reach the supplier must not be queued again on every tick. `keep_alive_next_at` is
  written before the job is queued. Task 3 tick test.
- A supplier that needs the owner (paused, session, needs_reconnect) is never visited. Task 3 tick test.
- A keep-alive that finds the session gone, with automatic login, logs in once. Without automatic login it raises
  `login_required`. An unclear page marks nothing. Task 3 verify tests.
- An omitted `keepAliveMinutes` in PUT /schedule leaves the setting as it is, and a value not in the list gives 400.
  Task 4 API tests.

---

### Task 1: Columns

**Files:** `packages/db/src/schema.ts`, `packages/db/drizzle/0018_keep_alive.sql` (+ meta), `packages/db/src/supplier-repository.ts`, `packages/db/test/supplier-repository.int.test.ts`

- Produces:
  - `SupplierRecord.keepAliveMinutes: number | null` and `keepAliveNextAt: Date | null`.
  - `setSchedule(id, { …, keepAliveMinutes?: number | null })`, which also sets `keepAliveNextAt: null` when
    `keepAliveMinutes` is given.
  - `setKeepAliveNext(id, at: Date)`.
  - `keepingAlive(): Promise<SupplierRecord[]>`.
- [ ] Int test: setSchedule with `keepAliveMinutes: 30` is read back and listed by `keepingAlive()`. Omitting it keeps
  30. A value of 20 is refused by the check constraint.

### Task 2: keepAliveDue

**Files:** `packages/scheduling/src/schedule.ts`, `schedule.test.ts`

- Produces: `KEEP_ALIVE_CHOICES`, and
  `keepAliveDue(i: { now: Date; minutes: number; nextAt: Date | null; lastVerifiedAt: Date | null; window: Window; timeZone: string; rand?: () => number }): { due: boolean; nextAt: Date }`.
- [ ] Tests, each with `rand = () => 0.5` so there is no spread:
  - Outside the window, `due` is false.
  - `nextAt` in the future: `due` is false and `nextAt` is unchanged.
  - Verified 10 minutes ago with 30-minute keep-alive: `due` is false and `nextAt` is `lastVerifiedAt + 30m`.
  - Due: `due` is true and `nextAt` is `now + 30m`.
  - `rand = () => 1` gives `now + 33m`, and `rand = () => 0` gives `now + 27m`.

### Task 3: Tick and visit

**Files:** `apps/worker/src/scheduling-tick.ts`, `apps/worker/src/supplier-verify.ts`, their int tests

- [ ] Tick tests:
  - Due, granted and connected: one `supplier.session.verify {keepAlive:true}` is queued and `keepAliveNextAt` is set.
  - A second tick queues nothing.
  - Paused, `needs_reconnect`, running, or outside the window: nothing is queued.
- [ ] Verify tests with `keepAlive`:
  - ok refreshes the session.
  - A login page with automatic login calls the browser `login` once and ends ok.
  - A login page without automatic login raises `login_required`.
  - An unknown page marks nothing.

### Task 4: API

**Files:** `apps/api/src/routes/schedule.ts`, `apps/api/test/schedule.int.test.ts`

- [ ] Tests:
  - PUT with `keepAliveMinutes: 30` stores it and the supplier record shows it.
  - Omitted, it is unchanged.
  - A value of 20 or "30" gives 400.
  - null turns it off.

### Task 5: Screen and docs

**Files:** `apps/web/src/api.ts`, `apps/web/src/components/SchedulePanel.tsx`, `scheduleWords.ts`, tests, `apps/web/src/test/fake-api.ts`, `docs/deployment.md`

- [ ] Test: the "Keep login alive" select has Off and the five choices, shows the saved value, and Save sends `keepAliveMinutes`.
- [ ] Docs: one paragraph saying what it does, the window rule, and the one-login-a-day trade-off.
