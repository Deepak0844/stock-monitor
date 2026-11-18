# Email Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Email the owner once for each new login problem, and re-run a check that a login problem stopped, after the hand login.

**Architecture:** A notice gets an `emailed_at` column. The minute tick claims each open, un-emailed login notice and
sends it through Gmail SMTP with nodemailer; a failed send releases the claim. The plain check that follows a hand login
carries `afterLogin`, and on ok it re-runs a run that a login stopped.

**Tech Stack:** TypeScript, Drizzle and Postgres, pg-boss, nodemailer, vitest with testcontainers.

**Spec:** `docs/superpowers/specs/2026-11-18-email-alerts-design.md`

## Global Constraints

- Only notices of kind `supplier_needs_reconnect` are emailed, whatever their reason.
- No email ever holds a password, a cookie or a session, and the app password is never logged.
- Gmail settings: `smtp.gmail.com`, port 465, TLS. Connection timeout 15 s.
- At most 10 emails per tick.
- Login stop reasons for the re-run: `login_required`, `captcha`, `blocked`.
- No supplier names in repo files. No Claude attribution lines in commits.

## Review Focus

- **A notice closes between the read and the send.** No email goes out, because the claim checks `resolved_at is null`. Task 1 test.
- **Gmail refuses (wrong app password, offline).** The tick still finishes, and the notice is tried again on the next tick. Task 3 test.
- **Notices open when the migration runs.** They are never emailed. Task 1 test.
- **The re-run when a run is already going, or the gate refuses the supplier.** No second run starts. Task 4 test.
- **Settings only half filled.** The worker refuses to start and names what is missing. Task 2 test.

---

### Task 1: emailed_at and the notice queries

**Files:**
- Modify: `packages/db/src/schema.ts` (the `notifications` table)
- Create: `packages/db/drizzle/0019_alert_emails.sql` and its meta, generated the same way as 0018
- Modify: `packages/db/src/notification-repository.ts`
- Test: `packages/db/test/notification-repository.int.test.ts` (create it if it is missing)

**Interfaces:**
- Produces, on the notification repository:
  - `unemailedLogin(limit: number): Promise<NotificationRecord[]>`: open notices of kind `supplier_needs_reconnect` with `emailed_at` null, oldest first.
  - `claimEmail(id: string): Promise<boolean>`: sets `emailed_at = now()` where `emailed_at` is null and `resolved_at` is null.
  - `releaseEmail(id: string): Promise<void>`: sets `emailed_at` back to null.

- [ ] Migration 0019 does two things:
  - `alter table notifications add column emailed_at timestamptz;`
  - `update notifications set emailed_at = now() where resolved_at is null;`
- [ ] Int tests:
  - `unemailedLogin` lists only open login notices that have not been emailed. It does not list `recipe_needs_review`, resolved notices, or emailed ones.
  - `claimEmail` is true once, then false.
  - `claimEmail` on a resolved notice is false.
  - `releaseEmail` lists the notice again.
  - `raise` on an open, emailed notice keeps `emailed_at`.
  - A notice open before migration 0019 has `emailed_at` set. Insert a row, re-run the 0019 update statement on it, and read it back.
- [ ] Watch the tests fail, implement, watch them pass, then commit.

### Task 2: Settings

**Files:**
- `packages/shared/src/config.ts`
- `packages/shared/src/config.test.ts`
- `.env.example`
- `docker-compose.yml` (worker environment)

**Interfaces:**
- Produces `Config.alertEmail: { from: string; appPassword: string; to: string } | undefined`.

- [ ] Unit tests:
  - All three blank or missing gives `alertEmail` undefined.
  - All three set gives the object. `from` and `to` must be email addresses.
  - Only some set throws a message that names the missing settings, for example `ALERT_EMAIL_APP_PASSWORD`.
  - The thrown message never contains the password value.
- [ ] Add `ALERT_EMAIL_FROM`, `ALERT_EMAIL_APP_PASSWORD` and `ALERT_EMAIL_TO` to `BLANK_MEANS_UNSET`.
- [ ] `.env.example` gets the three blank settings under one comment: the supplier Gmail, its app password, and where alerts go.
- [ ] `docker-compose.yml` passes the three settings and `APP_ORIGIN` to the worker.
- [ ] Commit.

### Task 3: Mailer and the sweep in the tick

**Files:**
- Create: `apps/worker/src/alert-email.ts`
- Modify: `apps/worker/src/scheduling-tick.ts`, `apps/worker/src/index.ts`, `apps/worker/package.json` (add `nodemailer` and `@types/nodemailer`)
- Test: `apps/worker/src/alert-email.test.ts` (unit), and `apps/worker/test/scheduling-tick.int.test.ts`

**Interfaces:**
- Consumes the Task 1 repository methods and Task 2 `Config.alertEmail`.
- Produces:
  - `type SendMail = (mail: { subject: string; text: string }) => Promise<void>`
  - `createGmailSender(c: { from: string; appPassword: string; to: string }): SendMail`, using nodemailer `createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth, connectionTimeout: 15_000 })`.
  - `loginAlertMail(n: { supplierId: string; supplierName: string; message: string }, appOrigin: string | undefined): { subject: string; text: string }`
  - `sendLoginAlerts(deps: { notifications; send: SendMail; appOrigin: string | undefined; logger }): Promise<number>`, which returns the number sent.
  - `TickDeps.alerts?: { send: SendMail; appOrigin: string | undefined }`

- [ ] `loginAlertMail` gives exactly this text:
  - Subject: `<name> needs you to log in`
  - Text: `<message>\n\nLog in here: <origin>/suppliers/<id>/connect\n\nSent by Stock Monitor.`
  - `<origin>` defaults to `http://localhost:3000` when `appOrigin` is blank.
- [ ] Unit tests: the exact subject and text for both origin cases.
- [ ] Tick int tests, with a fake `send` that records mail:
  - A login notice is sent once over two ticks.
  - A `recipe_needs_review` notice is never sent.
  - A send that throws on the first tick sends on the second, and the first tick still returns normally.
  - A notice resolved before the tick is not sent.
  - Twelve notices give 10, then 2.
  - No `alerts` in deps means nothing is sent.
- [ ] `sendLoginAlerts` runs at the end of `runTick`. Every send is wrapped: on an error, `releaseEmail` and `logger.warn({ supplierId, code: err.code }, "alert email could not be sent")`.
- [ ] `index.ts`: when `config.alertEmail` is set, pass `alerts` to the scheduling deps. Otherwise log `email alerts are off` once at start.
- [ ] Commit.

### Task 4: Re-run after a hand login

**Files:**
- `packages/queue/src/jobs.ts` and `jobs.test.ts`
- `apps/api/src/routes/login-sessions.ts` and its int test
- `apps/worker/src/supplier-verify.ts`
- `apps/worker/test/supplier-verify.int.test.ts`
- `apps/worker/src/index.ts`

**Interfaces:**
- Produces:
  - `supplier.session.verify` payload gains `afterLogin?: true`.
  - `verifySupplierSession(..., options: { ...; afterLogin?: boolean })`.
  - `SupplierVerifyDeps.rerun?: { checkRuns; recipes; queue: Pick<Queue, "enqueue">; timezone: string }`.
  - The audit action `supplier.rerun_queued`, with details `{ how: "schedule" | "started", runId? }`.

- [ ] Jobs unit test: `afterLogin: true` parses, and `afterLogin: false` throws.
- [ ] API int test: finishing a hand login queues `supplier.session.verify` with `{ supplierId, afterLogin: true }`.
- [ ] Verify int tests, all with `afterLogin`:
  - Newest ended run `stopped`/`captcha`, automatic checks on, `next_check_at` 3 hours ahead: `next_check_at` becomes now, an audit is recorded with `how: "schedule"`, and no job is queued.
  - The same with automatic checks off: a `manual` run is started and `extraction.checks` is queued with its `runId`.
  - Newest ended run `finished`, or `stopped`/`unreachable`: nothing changes.
  - A run already going: nothing starts.
  - A supplier with no stock rules (the gate refuses it): nothing starts.
  - The check finds a login page: no re-run.
  - Without `afterLogin`, an ok check never re-runs.
- [ ] Implement:
  - On `ok` with `options.afterLogin && deps.rerun`, call `rerunAfterLogin`.
  - "Newest ended run" is `checkRuns.recent(id, 2).find((r) => r.endedAt)`.
  - Moving the next check uses `suppliers.recordRunEnd(id, { nextCheckAt: now, failureCount: supplier.failureCount })`, only if `next_check_at` is null or later than now.
  - Starting a run mirrors `stock-checks.ts`: count enabled links (none means no run), `checkRuns.start(id, "manual", links)`, enqueue with `runExpirySeconds`, and end the run as `failed`/`not_queued` if the enqueue throws. The gate is `stockGate` from `extraction-check.ts`.
- [ ] Wire `rerun` in `index.ts`, then commit.

### Task 5: Docs

**Files:** `docs/deployment.md`

- [ ] Add an "Email alerts" section with:
  - turning on 2-Step Verification on the supplier Gmail, then making an App password;
  - the three settings, then `docker compose up -d --build`;
  - that only login problems are emailed, once each;
  - that a failed send is tried again every minute;
  - that the re-run follows a hand login.
- [ ] Run `npm run check`, then commit.
