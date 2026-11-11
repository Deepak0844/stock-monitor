# Profile-mode queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In `VERIFY_MODE=profile`, captures and connection checks no longer stall behind scheduled checks or abandoned jobs, and a full queue answers "busy" at once.

**Architecture:** One small job-queue helper (two lanes, skip-if-abandoned, bounded) replaces the single `inTurn` chain in the profile checker. The control server passes each request's "caller went away" signal to the job and turns a full queue into HTTP 503. The client, worker and screen learn one new capture outcome, `busy`.

**Tech Stack:** TypeScript, vitest, Node http. Branch from `develop`, e.g. `fix/profile-queue`. Use npm.

**Spec:** `docs/superpowers/specs/2026-11-12-profile-queue-design.md`

## Global Constraints

- Headless mode, the login window and request/answer formats do not change.
- Queue holds at most 8 waiting jobs (`MAX_WAITING = 8`). Capture and verify client limit is 90 000 ms. Both are the owner-approved values.
- Busy message: "The browser is busy with other checks. Try again in a minute."
- Test first. No supplier names or domains in the repo. No Claude attribution lines in commits.

## Review Focus

- Caller gives up while its job is queued: the job never runs (Task 1, Task 2).
- Caller gives up while its job runs: the job finishes and the queue moves on (Task 1).
- Two scheduled checks plus one capture waiting: the capture runs next, scheduled ones keep their order (Task 1).
- Ninth waiting job: refused immediately, running and queued jobs unaffected (Task 1, Task 2).
- A job that throws does not block the next one (Task 1).

---

### Task 1: The job queue, used by the profile checker

**Files:**
- Create: `services/browser/src/job-queue.ts`, `services/browser/src/job-queue.test.ts`
- Modify: `services/browser/src/profile-check.ts` (the `chain` / `inTurn` block and the three exported entry points, around lines 226-238)

**Interfaces:**
- Produces: `export const MAX_WAITING = 8`; `export class QueueFullError extends Error` (name `"QueueFullError"`); `export class AbandonedError extends Error` (name `"AbandonedError"`); `export function createJobQueue(options?: { maxWaiting?: number }): { run<T>(job: () => Promise<T>, opts?: { urgent?: boolean; signal?: AbortSignal }): Promise<T> }`.
- Produces: profile checker entry points take an options argument: `verify(request, opts?)`, `checkPage(request, timeoutMs?, opts?)`, `capture(request, timeoutMs?, opts?)` where `opts: { signal?: AbortSignal }`. `verify` and `capture` run urgent; `checkPage` runs not urgent.

- [ ] **Step 1: Write failing tests in `job-queue.test.ts`.** Use a helper that returns a job and a manual `release()` so ordering is observable. Tests (names exact):
  - `runs one job at a time, first come first served` — three non-urgent jobs start in call order, never two at once.
  - `an urgent job waits for the running job but goes ahead of waiting ordinary jobs` — job A running, B and C ordinary waiting, then urgent D: order is A, D, B, C.
  - `urgent jobs keep their own order` — two urgent waiters run in call order.
  - `skips a waiting job whose caller has gone, and rejects its promise with AbandonedError` — abort the signal while waiting; the job function is never called; next job still runs.
  - `a job that is already running finishes when its caller goes` — abort after start; job resolves normally.
  - `refuses a job when maxWaiting jobs are already waiting, with QueueFullError, at once` — `maxWaiting: 2`, one running, two waiting, the next rejects immediately; the running and waiting jobs still complete. The running job does not count as waiting.
  - `a job that throws does not block the next job` — first rejects, second still runs.
  - `a signal already aborted when run is called rejects with AbandonedError without queueing`.
- [ ] **Step 2: Run** `npx vitest run services/browser/src/job-queue.test.ts` — expect FAIL (module missing).
- [ ] **Step 3: Implement `createJobQueue`.** Two arrays (urgent, ordinary) of waiters; a `running` flag; after each job settles, take the next waiter (urgent first), skipping any whose signal is aborted (reject with `AbandonedError`). Waiting count = both arrays' lengths. Abort while waiting: remove the waiter and reject at once (don't wait for its turn).
- [ ] **Step 4: Run the tests** — expect PASS.
- [ ] **Step 5: Wire into `profile-check.ts`.** Replace `chain`/`inTurn` with one `const queue = createJobQueue()`; `verify` → `queue.run(() => check(request), { urgent: true, signal: opts?.signal })`; `capture` urgent; `checkPage` not urgent. Existing exported types stay. Update `services/browser/test/profile-check.browser.test.ts` only if it breaks (it needs the browser image; run `npm run test:browser` if the environment allows, otherwise say it was not run).
- [ ] **Step 6: Commit** `feat(browser): profile checks queue with priority, skip abandoned jobs, and refuse when full`.

### Task 2: Control server passes the signal and answers 503

**Files:**
- Modify: `services/browser/src/server.ts` (types at lines 7-9, handler around line 148), `services/browser/src/service.ts` (lines ~112-122, pass the signal through)
- Test: `services/browser/src/server.test.ts`

**Interfaces:**
- Consumes: `QueueFullError`, `AbandonedError` from Task 1.
- Produces: `VerifyFn`, `CheckPageFn`, `CaptureFn` gain a second parameter `opts: { signal: AbortSignal }`. A job that throws `QueueFullError` makes the server reply `503 {"error":"busy"}`. A job that throws `AbandonedError` writes no reply (connection is already closed) and logs nothing.

- [ ] **Step 1: Write failing tests in `server.test.ts`:**
  - `answers 503 busy when the job says the queue is full` — `capture` mock rejects `new QueueFullError()`; POST `/capture`; expect status 503, body `{ error: "busy" }`; `logs` has no `capture failed` line.
  - `gives the job a signal that fires when the caller goes away` — mock `capture` records its `opts.signal` and never resolves; client aborts its fetch; `await vi.waitFor(() => expect(signal.aborted).toBe(true))`.
  - `does not abort the signal when the answer was sent normally` — after a normal answer the signal is not aborted.
- [ ] **Step 2: Run** `npx vitest run services/browser/src/server.test.ts` — expect the new tests FAIL.
- [ ] **Step 3: Implement.** In the handler, create an `AbortController`; abort it on `res.on("close")` only when `!res.writableEnded`. Pass `{ signal }` to the chosen function. In the catch, map error names `QueueFullError` → 503 busy and `AbandonedError` → return silently; everything else stays the 500 path. In `service.ts` forward the signal to `checkInProfile.verify/capture/checkPage` (headless branch ignores it).
- [ ] **Step 4: Run** the whole file — expect PASS (existing tests still green).
- [ ] **Step 5: Commit** `feat(browser): answer busy when the profile queue is full, tell jobs when the caller left`.

### Task 3: Client, worker and screen learn "busy"

**Files:**
- Modify: `packages/browser-client/src/client.ts` (capture type line 16-19, `capture` method line ~128, `verify` method), `packages/browser-client/test/fake-browser-service.ts` (capture/verify behaviour gets `"busy"`), `apps/worker/src/extraction-capture.ts` (line 53), `apps/web/src/components/stockWords.ts` (`CAPTURE_FAILURES`)
- Test: `packages/browser-client/src/client.test.ts`, `apps/worker/test/extraction-capture.int.test.ts`, the existing test file for `stockWords` if one exists (otherwise add the assertion beside the nearest web test)

**Interfaces:**
- Consumes: HTTP 503 `{error:"busy"}` from Task 2.
- Produces: `CaptureOutcome` failure reason union becomes `"failed" | "unavailable" | "busy"`. `capture` and `verify` calls use limit `CAPTURE_LIMIT_MS = 90_000`. Failure code `browser_busy` is stored on the capture (the column is free text with no constraint, so no migration).

- [ ] **Step 1: Write failing tests:**
  - client: `capture says busy when the service answers 503` (set `fake.behaviour.capture = "busy"`; expect `{ ok: false, reason: "busy" }`).
  - client: `capture and verify allow 90 seconds` — inject `fetchImpl` that captures the `signal` and assert it is still not aborted after 31 s using fake timers, or assert via a small exported constant `CAPTURE_LIMIT_MS === 90_000` if timers are awkward.
  - client: `verify treats 503 as unavailable` (existing reason, not a new one).
  - worker: `records browser_busy when the browser says busy` and keeps `browser_unavailable` for `unavailable`.
  - web: `captureFailureWords("browser_busy")` returns "The browser is busy with other checks. Try again in a minute."
- [ ] **Step 2: Run** `npx vitest run packages/browser-client apps/web` and the worker int test per the repo's usual command — expect the new tests FAIL.
- [ ] **Step 3: Implement.** `call(...)` already takes a `limit`; pass `CAPTURE_LIMIT_MS` for capture and verify, and have `call` return the status so a 503 with `error: "busy"` is distinguishable (capture returns `busy`; verify and checkPage keep `unavailable`). Worker: `outcome.reason === "busy" ? "browser_busy" : "browser_unavailable"`. Add the message to `CAPTURE_FAILURES`.
- [ ] **Step 4: Run** the three suites, then `npm run typecheck` and `npm run lint` — expect all PASS.
- [ ] **Step 5: Manual check (owner stack untouched).** Say plainly if this was not run: with `VERIFY_MODE=profile`, start a capture while a scheduled check runs; the capture starts as soon as the running job ends.
- [ ] **Step 6: Commit** `feat(browser-client,worker,web): a busy browser is its own capture failure with a plain message`.

---

Self-review: spec items 1-4 map to Tasks 1, 1, 1+2, 3. Names used across tasks (`QueueFullError`, `AbandonedError`, `{ signal }`, `busy`, `browser_busy`, `CAPTURE_LIMIT_MS`) match.
