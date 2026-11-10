# Tasks: foundation (complete, archived 2026-11-08)

Every task is test-first (red, green, refactor). Run `npm run check` before marking a task done.

## Task 1: Monorepo scaffold and tooling
**Description:** npm workspace with `apps/api`, `apps/worker`, `apps/web`, `packages/*`, TypeScript strict, ESLint, Prettier, Vitest, and the root scripts from the spec.
**Acceptance criteria:**
- [x] `npm install && npm run check` passes on a clean checkout
- [x] A trivial test in `packages/shared` runs through `npm run test:unit`
- [x] `.env.example` and `.gitignore` (excludes `.env`) exist

**Status:** done 2026-11-08. Note: `test:e2e` script is added in Task 9. TypeScript is pinned to 6.x because typescript-eslint does not yet support 7.
**Verification:** `npm run check`
**Dependencies:** None
**Files:** root configs, `packages/shared/*`
**Scope:** Medium

## Task 2: Config validation and safe logging
**Description:** Zod-validated environment config that stops startup on bad input, and a pino logger that redacts secrets.
**Acceptance criteria:**
- [x] Startup fails with a clear message when a variable is missing or malformed
- [x] A test logs a fake password, token and cookie and none appears in output
- [x] Authorization and cookie headers are redacted
**Verification:** `npm run test:unit`
**Dependencies:** 1
**Files:** `packages/shared/src/config.ts`, `packages/shared/src/logger.ts`, tests
**Scope:** Small

**Status:** done 2026-11-08. `redactSecrets` in `packages/shared` is reused by the audit writer in Task 5.

## Task 3: Database, migrations and test harness
**Description:** Drizzle schema for `users`, `app_sessions`, `audit_events`, `app_settings`; migrations; Testcontainers helper for integration tests.
**Acceptance criteria:**
- [x] Migrations apply cleanly to an empty PostgreSQL
- [x] Integration test harness starts and stops a real PostgreSQL
- [x] `users.email` is unique, and tables match the spec
**Verification:** `npm run test:integration`
**Dependencies:** 1
**Files:** `packages/db/src/schema.ts`, migrations, `packages/db/test/harness.ts`, tests
**Scope:** Medium

**Status:** done 2026-11-08. Harness falls back to the OrbStack socket when `DOCKER_HOST` is unset. `db:migrate` runner is added in Task 10. Also fixed a Task 1 script bug: the integration filter is a substring, not a glob.

### Checkpoint: after Task 3
- [x] `npm run check` passes, including a real database test
- [x] Docker works for tests on this machine
- [x] Review with owner before continuing (owner approved continuing)

## Task 4: Crypto package
**Description:** AES-256-GCM `encrypt` and `decrypt` with `keyId`, plus a key loader that reads `APP_ENCRYPTION_KEY`.
**Acceptance criteria:**
- [x] Round trip returns the original text
- [x] A changed ciphertext, tag or wrong key makes `decrypt` throw
- [x] A key of the wrong length is rejected at load
**Verification:** `npm run test:unit`
**Dependencies:** 1
**Files:** `packages/crypto/src/{encrypt,decrypt,key}.ts`, tests
**Scope:** Small

**Status:** done 2026-11-08.

## Task 5: Audit writer with restricted database role
**Description:** `audit.record()` with a detail redactor, and a database role for the app that can INSERT and SELECT but not UPDATE or DELETE on `audit_events`.
**Acceptance criteria:**
- [x] An event is stored with actor, action, entity and request id
- [x] Secret-like keys in `details` are stripped
- [x] An UPDATE or DELETE on `audit_events` by the app role fails (integration test)
**Verification:** `npm run test:integration`
**Dependencies:** 3
**Files:** `packages/audit/src/*`, role migration, tests
**Scope:** Medium

**Status:** done 2026-11-08. App connects as a login role inside `app_user`; production setup must create that login role and `GRANT app_user` to it.

## Task 6: API skeleton with route protection
**Description:** Fastify app with `/health`, a stable error format, request ids and a hook that rejects unauthenticated requests outside an allow-list.
**Acceptance criteria:**
- [x] `/health` returns OK without login
- [x] Any other route returns 401 with a plain-English message and error code when there is no session
- [x] Errors never include stack traces
**Verification:** `npm run test:integration` (uses `inject()`)
**Dependencies:** 2, 3
**Files:** `apps/api/src/{app,errors,auth-hook}.ts`, tests
**Scope:** Medium

**Status:** done 2026-11-08. Unknown URLs return 401 when signed out, so routes are not revealed. `/api/me` is the first protected route.

### Checkpoint: after Task 6
- [x] `npm run check` passes
- [x] No secret appears in logs for any request tested
- [x] Review with owner before continuing (owner approved continuing)

## Task 7: Owner creation, login and logout
**Description:** `npm run create-owner` CLI, login and logout routes, argon2id hashing, server-side sessions with token hash, httpOnly cookie, expiry, login rate limit, audit events.
**Acceptance criteria:**
- [x] Correct credentials give a session cookie. Wrong ones return one generic error
- [x] Repeated failures are rate-limited
- [x] Logout and expiry invalidate the session
- [x] Login, logout and failed login each write an audit event
- [x] No public signup route exists
**Verification:** `npm run test:integration`
**Dependencies:** 4, 5, 6
**Files:** `apps/api/src/routes/auth.ts`, `apps/api/src/cli/create-owner.ts`, `packages/db` repositories, tests
**Scope:** Medium

**Status:** done 2026-11-08. Login limiter is in memory (resets on restart), keyed by IP and email, 5 failures per 15 minutes. Sessions last 7 days. The `create-owner` CLI wrapper has no automated test; its logic lives in `createOwner`, which is tested. Smoke-test it after Task 10 when `docker compose` and a migrate command exist.

## Task 8: Queue and worker
**Description:** pg-boss setup with typed `enqueue`, a worker that registers handlers, and the `health.ping` job.
**Acceptance criteria:**
- [x] A `health.ping` job is enqueued and processed by the worker in a test
- [x] Payloads are validated with Zod
**Verification:** `npm run test:integration`
**Dependencies:** 3
**Files:** `packages/queue/src/*`, `apps/worker/src/index.ts`, tests
**Scope:** Medium

**Status:** done 2026-11-08. pg-boss 12 creates its own `pgboss` schema, so migration 0002 grants CREATE on the database to `app_user`. This gives no rights on the audit table. Worker entry point (`index.ts`) is startup glue and is not unit tested; handler registration is.

## Task 9: Web shell with login and protected page, plus e2e
**Description:** Minimal React app with a login form, a protected placeholder page, logout and plain-English errors, plus the Playwright journey.
**Acceptance criteria:**
- [x] The owner logs in, sees the protected page, logs out
- [x] After logout the protected page is blocked
- [x] Wrong password shows a clear message, and the form is keyboard and screen-reader friendly
**Verification:** `npm run test:e2e`
**Dependencies:** 7
**Files:** `apps/web/src/*`, `e2e/login.spec.ts`
**Scope:** Medium
**Note:** UI work, so `ui-ux-pro-max` and `design-taste-frontend` apply here.

**Status:** done 2026-11-08. The API now serves the built web app from the same origin (`webRoot`), with security headers. Playwright runs on desktop and phone sizes, including an axe accessibility scan, and has its own `e2e` job in CI. `npm run test:e2e` builds first. jsx-a11y lint is not used because it does not support ESLint 10 yet. The `e2e` CI job is not a required check yet.

## Task 10: Docker Compose
**Description:** Compose file for PostgreSQL, API, worker and web, with environment variables from `.env`.
**Acceptance criteria:**
- [x] `docker compose up` starts all services and `/health` returns OK
- [x] The worker processes a `health.ping` job in the composed stack
- [x] No real secrets are committed
**Verification:** `docker compose up` plus a manual health check
**Dependencies:** 6, 8, 9
**Files:** `docker-compose.yml`, Dockerfiles, `.env.example`
**Scope:** Medium

**Status:** done 2026-11-08. Verified by running the real stack, not only by tests. The web app is served by the API, so the compose file has no separate web service. Added: API server entry point, `npm run db:migrate` (runs migrations, creates the restricted login role), `COOKIE_SECURE`, `TRUST_PROXY` and `HOST` settings, a fix so `create-owner` accepts piped input (with tests), `docs/deployment.md`. Backups are documented but not automated.

### Checkpoint: foundation complete
- [x] All nine spec success criteria met, except "migrations reversible in dev": Drizzle only migrates forward (documented in `docs/deployment.md`)
- [x] `npm run check` and `npm run test:e2e` pass
- [x] Review with owner, then write `SPEC-shopify.md` (done, approved 2026-11-08)
