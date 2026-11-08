# Capability Map: Supplier Stock Monitor

Approved by the owner on 2026-11-08. Intent: `docs/intent/stock-monitor.md`.

| Module id | Responsibility | Depends on |
|---|---|---|
| `foundation` | Monorepo, database schema, encrypted secrets, app login, audit log, queue | none |
| `shopify` | Admin API client, location setting, reads, approved writes, conflict check, idempotent retries | foundation |
| `supplier-session` | Supplier records, isolated browser service, noVNC login, encrypted session storage, expiry and CAPTCHA detection, reconnect | foundation |
| `mapping` | Mappings from Shopify variants to supplier pages, metafield sync, CSV import, broken-link checks | foundation, shopify (read), supplier-session (supplier records) |
| `extraction` | Recipe step list and editor, page capture, check runner, observations (quantity, text, page state) | foundation, supplier-session |
| `scheduling` | Intervals, "Check now", per-supplier concurrency, retries and backoff, progress | extraction, mapping |
| `proposals` | Proposal rules, approval inbox, approve/reject/edit, expiry, conflict handling, history | extraction, mapping, shopify |
| `ui-shell` | Dashboard, notifications, settings, responsive layout | all, built progressively |

Build order: foundation, shopify (read), **supplier-session**, mapping, extraction, scheduling, proposals + shopify (write), ui-shell polish.

Changed 2026-11-08: `supplier-session` now comes before `mapping`. Every mapping points at a supplier, and the supplier records belong to `supplier-session`. It is also the riskiest module (real supplier sites, logins and CAPTCHAs), so it is better learned about early. The mapping screen's "Test" button needs `extraction`, so it comes later either way.

Pilot scope: one supplier, one mapping per variant. Bulk approval, multi-supplier rules and the React Flow view come after the pilot.

## Stack (assumed, approved unless changed)
Monorepo: `apps/web` (React), `apps/api` (Fastify), `apps/worker` (Playwright), `packages/shared` (types, Zod schemas). PostgreSQL, pg-boss queue, Docker Compose on one VPS. Single owner login.

## Testing strategy (applies to every module spec)
- TDD: failing test first, then the smallest code to pass, then refactor.
- Unit: Vitest. Integration: Vitest with real PostgreSQL (Testcontainers), API via Fastify `inject()`.
- Recipe tests run against captured HTML and screenshot fixtures: in stock, out of stock, region not listed, 404, login redirect.
- Shopify: fake Shopify server in tests, plus a contract check against a development store.
- Frontend: Vitest and Testing Library, with accessibility checks.
- End to end: Playwright Test against a fake supplier site and the fake Shopify server.
  1. Reconnect supplier, checks resume.
  2. Check, proposal, approval, Shopify update recorded.
  3. Login expiry or CAPTCHA pauses checks and never proposes out of stock.
  4. Shopify conflict blocks the apply.
  5. A retried update never applies twice.
- No skipped or weakened tests. CI runs all levels on every change. Automated tests never hit a real supplier.
- Real-supplier validation is a documented manual step, and no adapter is called working before it.
