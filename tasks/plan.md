# Implementation Plan: foundation

Spec: `SPEC-foundation.md` (approved 2026-11-08). Map: `CAPABILITY-MAP.md`. Tasks are in `tasks/todo.md`.

## Overview
Build the base every other module needs: a monorepo that builds and tests, PostgreSQL with migrations, encrypted secrets, single-owner login, an append-only audit log and a job queue. No supplier or Shopify logic.

## Architecture Decisions
- pnpm workspaces with `apps/*` and `packages/*`. Shared code in `packages/` keeps the API, worker and web separate but consistent.
- Drizzle ORM with drizzle-kit migrations (owner decision).
- Integration tests use real PostgreSQL through Testcontainers, never a mocked database.
- The app connects as a database role with INSERT and SELECT only on `audit_events`. A separate migration role owns the schema. This makes the audit log tamper-resistant at the database level.
- The encryption key is read by one function from `APP_ENCRYPTION_KEY`, so a secret manager can replace it later.
- Server-side sessions in PostgreSQL, so logout and expiry are real. Only a hash of the session token is stored.
- Slicing is vertical where it can be. Packages (crypto, audit, queue) come first because each is tested in isolation and used by later slices.

## Dependency graph
```
1 scaffold
 ├─ 2 config + logging
 ├─ 3 db + test harness ─┬─ 5 audit writer + restricted role
 │                       └─ 7 login/session ── 9 web shell + e2e
 ├─ 4 crypto
 ├─ 6 api skeleton (needs 2, 3) ── 7
 ├─ 8 queue + worker (needs 3)
 └─ 10 docker compose (needs 6, 8, 9)
```

## Task List
See `tasks/todo.md`. Order: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, with checkpoints after 3, 6 and 10.

## Risks and Mitigations
| Risk | Impact | Mitigation |
|---|---|---|
| Restricted audit role is hard to set up in migrations and tests | Medium | Do it early (task 5), with an integration test that proves UPDATE and DELETE fail |
| Testcontainers needs Docker on the dev machine and in CI | Medium | Confirm Docker works in task 3, before building more on it |
| Secrets leak into logs through request bodies or errors | High | Redaction tested with a fake secret in task 2, re-checked in tasks 6 and 7 |
| Session or cookie mistakes in login | High | Test-first, with explicit tests for expiry, logout, wrong password and rate limiting |
| Library versions drift | Low | Pin in the lockfile. Verify against official docs when installing |

## Open Questions
None.
