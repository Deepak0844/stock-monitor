# Spec: foundation

Module id: `foundation`. Depends on: none. Map: `CAPABILITY-MAP.md`. Intent: `docs/intent/stock-monitor.md`.

## Objective
Give every later module a safe base: a monorepo that builds and tests, a PostgreSQL schema with migrations, encrypted secret storage, single-owner login, an append-only audit log and a job queue. It contains no supplier or Shopify logic.

User: the store owner, through every later module. Success means a later module can store an encrypted secret, require a logged-in owner, write an audit event and enqueue a job, with tests proving each.

## Tech Stack
Versions are the latest stable at implementation time. Pin them in the lockfile and verify against official docs before use.
- Node.js LTS, TypeScript (strict), npm workspaces.
- API: Fastify, Zod for validation (`fastify-type-provider-zod`).
- Database: PostgreSQL, Drizzle ORM and drizzle-kit migrations.
- Queue: pg-boss (uses the same PostgreSQL).
- Auth: argon2 password hashing, server-side sessions in PostgreSQL, httpOnly SameSite cookie.
- Crypto: Node `crypto`, AES-256-GCM.
- Tests: Vitest, Testcontainers (PostgreSQL), Playwright Test for end to end.
- Lint and format: ESLint and Prettier.
- Containers: Docker Compose for local and VPS.

## Commands
```
Install:     npm install
Dev (all):   npm run dev
Build:       npm run build
Typecheck:   npm run typecheck
Lint:        npm run lint
Unit:        npm run test:unit
Integration: npm run test:integration
E2E:         npm run test:e2e
All checks:  npm run check            # typecheck, lint, unit, integration
DB migrate:  npm run db:migrate
DB generate: npm run db:generate
```

## Project Structure
```
apps/api/            Fastify API (routes, plugins)
apps/worker/         Queue worker entry (Playwright arrives in later modules)
apps/web/            React app (empty shell here; filled by ui-shell)
packages/shared/     Zod schemas, shared types, error codes
packages/db/         Drizzle schema, migrations, repositories
packages/crypto/     encrypt/decrypt, key loading
packages/audit/      audit event writer
packages/queue/      pg-boss setup and typed job helpers
e2e/                 Playwright Test suites
docs/intent/         Statement of intent
docker-compose.yml   postgres, api, worker, web
.env.example         every variable, no real values
```

## Scope

### Tables (foundation only)
| Table | Purpose |
|---|---|
| `users` | Owner account: id, email (unique), password_hash, created_at |
| `app_sessions` | Login sessions: id, user_id, token_hash, expires_at, created_at |
| `audit_events` | Append-only: id, at, actor_user_id (nullable), action, entity_type, entity_id, details (JSON, redacted), request_id |
| `app_settings` | Key and JSON value, for later modules |

pg-boss creates its own queue tables. Later modules add their own tables through new migrations.

### Behaviour
1. **Secrets.** `encrypt(plaintext) -> {ciphertext, iv, tag, keyId}` using AES-256-GCM, with the key loaded from the `APP_ENCRYPTION_KEY` environment variable and never stored in the database. `decrypt` fails loudly on tampering or a wrong key. Includes `keyId` so keys can be rotated later.
2. **Login.** Email and password, argon2id. A session cookie is httpOnly, Secure in production and SameSite=Lax. Login failures are rate-limited. There is one owner, created by a CLI command (`npm run create-owner`), with no public signup.
3. **Route protection.** A Fastify hook rejects any route not on an allow-list unless the session is valid.
4. **Audit.** `audit.record()` writes an event. The table has no update or delete path in code, and the database role used by the app has no UPDATE or DELETE on it. `details` passes through a redactor that strips keys named like password, token, cookie, secret.
5. **Logging.** Structured logs (pino) with a request id. The redactor config removes authorization headers, cookies and secret fields.
6. **Queue.** A typed `enqueue(jobName, payload)` and a worker that registers handlers. Includes one `health.ping` job used by tests.
7. **Config.** All environment variables are validated at startup with Zod. The app refuses to start if one is missing or malformed.
8. **Errors.** The API returns stable error codes with plain-English messages. It never returns stack traces.

## Code Style
```ts
// packages/crypto/src/encrypt.ts
import { createCipheriv, randomBytes } from "node:crypto";

export type Encrypted = { ciphertext: string; iv: string; tag: string; keyId: string };

export function encrypt(plaintext: string, key: Buffer, keyId: string): Encrypted {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    keyId,
  };
}
```
Conventions: strict TypeScript, no `any`, named exports, `kebab-case` files, `camelCase` code, `snake_case` database columns, one responsibility per file, no secrets in code or logs.

## Testing Strategy
All work is test-first (red, green, refactor).
- **Unit:** crypto round trip, tamper detection, wrong key fails, redactor strips secret keys, config validation rejects bad input.
- **Integration (real PostgreSQL via Testcontainers):** migrations apply cleanly from empty, login and session expiry, rate limit, protected route returns 401 without a session, audit event is written and cannot be updated or deleted by the app role, `health.ping` job runs through pg-boss.
- **E2E (Playwright Test):** owner logs in through the web shell, sees a protected page, logs out, and a protected route is blocked afterward.
- No test is skipped or weakened. Automated tests never use real secrets.

## Boundaries
- **Always:** write a failing test first, validate all input with Zod, redact secrets in logs and audit details, keep `.env` out of git, run `npm run check` before finishing a task.
- **Ask first:** adding a dependency beyond the stack above, changing a table design after it ships, changing CI.
- **Never:** store a password or key in the database, log a secret, add a public signup route, add an update or delete path for `audit_events`, skip or delete a failing test to get green.

## Success Criteria
1. `npm install && npm run check` passes on a clean checkout.
2. `docker compose up` starts PostgreSQL, API and worker, and `/health` returns OK.
3. Migrations apply from an empty database and are reversible in dev.
4. `encrypt` then `decrypt` returns the original text, and a changed ciphertext or key makes `decrypt` fail.
5. A protected route returns 401 without a session and 200 with one. Wrong passwords are rate-limited.
6. An audit event is written for login, logout and failed login, and an attempted update or delete on `audit_events` by the app role fails.
7. No secret appears in logs or audit details, shown by a test that logs a fake secret.
8. A `health.ping` job is enqueued and processed by the worker.
9. The end-to-end login journey passes.

## Decisions (owner, 2026-11-08)
1. ORM: Drizzle.
2. Owner login: username and password only, no two-factor in the MVP. Security comes from argon2id hashing, rate limiting, secure cookies and the audit log. The login name is the owner's email unless changed.

3. Encryption key: protected environment file on the VPS for the pilot, no secret manager. The key is read through one small function so a secret manager can replace it later. The key must be backed up separately, for example in a password manager.

Status: approved by the owner on 2026-11-08.

## Open Questions
None.
