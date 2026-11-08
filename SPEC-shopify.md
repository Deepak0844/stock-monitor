# Spec: shopify

Module id: `shopify`. Depends on: `foundation` (done). Map: `CAPABILITY-MAP.md`. Intent: `docs/intent/stock-monitor.md`.

Status: **draft for owner review.** Not approved. Phase A is specified in full. Phase B (writing to Shopify) is specified at contract level and is built together with `proposals`.

## Objective

Connect the app to the owner's Shopify store, safely and read-only first, so later modules can map supplier pages to real Shopify variants and later write approved stock changes.

Phase A (build now): connect the store, choose the inventory location, import products and variants with their current stock at that location, and show them in a searchable list.
Phase B (built with `proposals`): apply one approved quantity to one variant, refusing if the store's quantity changed since the owner reviewed it.

Success: the owner enters store details once, sees their real variants and stock, and the app holds **no permission to change Shopify** until Phase B is built.

## Verified against official Shopify documentation (2026-11-08)

- **API version:** 2026-10 is the latest stable version, supported until 2027-10-16. Stable versions do not change during their life. Each request must name a version. Plan a quarterly check. ([versioning](https://shopify.dev/docs/api/usage/versioning))
- **Getting a token:** a Dev Dashboard app exchanges its client ID and secret for an access token with the client credentials grant. The token is valid for **24 hours** (`expires_in` 86399) and is renewed by repeating the request. The grant works only when the app and the store belong to the **same organization**. ([Get API access tokens for Dev Dashboard apps](https://shopify.dev/docs/apps/build/dev-dashboard/get-api-access-tokens?lang=node), [Access tokens](https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens))
- **Changing stock:** `inventorySetQuantities` applies a change only if the stored quantity equals `changeFromQuantity`, and otherwise returns `CHANGE_FROM_QUANTITY_STALE`. From 2026-04 omitting `changeFromQuantity` is an error. `compareQuantity` and `ignoreCompareQuantity` are being removed. The mutation accepts an `@idempotent(key: ...)` directive. ([mutation](https://shopify.dev/docs/api/admin-graphql/latest/mutations/inventorySetQuantities), [changelog](https://shopify.dev/changelog/posts/finalizing-compare-and-swap-redesign-for-inventory-set-quantities))
- **Quantities:** `InventoryLevel.quantities(names: [...])` returns named states such as `available`, `on_hand`, `committed`. `available` is what customers can buy. ([InventoryLevel](https://shopify.dev/docs/api/admin-graphql/latest/objects/InventoryLevel), [guide](https://shopify.dev/docs/apps/build/inventory-management-apps/manage-quantities-states))
- **Rate limits:** the GraphQL Admin API limits by query cost, not request count. A bucket refills at a plan-dependent rate, a single query may cost at most 1,000 points, and every response reports `throttleStatus`. ([rate limits](https://shopify.dev/docs/apps/build/apis/graphql-admin/rate-limits))
- **Bulk operations** avoid per-query rate limits and are the route for very large catalogs. ([bulk operations](https://shopify.dev/docs/api/usage/bulk-operations/queries))

**Not yet verified, to confirm in the first implementation task by querying a development store:** the access scope the `locations` query needs; the exact field names of the product, variant and inventory queries in 2026-10; whether the owner's store and app share an organization; and the quirk reported in a community post that `changeFromQuantity: 0` can be rejected for a level that was never set.

## Assumptions (correct me now)

1. One Shopify store.
2. The owner creates an app in the **Dev Dashboard** under the same organization as the store, and installs it. The app stores the client ID and secret, encrypted, and fetches 24-hour tokens itself. If the owner already has a legacy custom app with a permanent token, the app can accept that token instead (a second credential type).
3. **Read-only permissions first.** Request only `read_products` and `read_inventory` (plus the locations scope once confirmed). `write_inventory` is added when Phase B is built, as a new app version the owner approves. Until then "never writes to Shopify" is true at the permission level, not only in code.
4. The app updates the **`available`** quantity, at **one chosen location**, one variant at a time. It does not touch `on_hand`, other locations, prices or any store setting.
5. GraphQL Admin API only, version pinned in one constant (`2026-10`).
6. Catalog of a few hundred variants, so plain cursor pagination is enough. Bulk operations are added only if the catalog is much larger.
7. No webhooks in the first version. The app re-reads stock when it needs it.
8. Variant stock is re-read from Shopify immediately before any write (Phase B).

## Data model (Phase A)

| Table | Purpose |
|---|---|
| `shopify_connection` | One row: shop domain, credential type (`client_credentials` or `static_token`), encrypted credentials (AES-GCM, `keyId` stored), granted scopes, chosen location id and name, connected at, last successful call, status (`connected`, `needs_reconnect`) |
| `shopify_variants` | One row per variant: variant GID, product GID, product title, variant title, option values (JSON), SKU, inventory item GID, `tracked`, `inventory_policy` (`DENY` or `CONTINUE`), `available` at the chosen location (nullable), `quantity_read_at`, `synced_at`, `removed_at` |
| `shopify_sync_runs` | Each sync: started, finished, status, counts (added, updated, removed), plain-English error |

Access tokens are held in memory and refreshed about 10 minutes before expiry. They are never written to the database or logs.

## Behaviour

1. **Connect.** Owner enters store domain, client ID and secret. The domain must match `^[a-z0-9][a-z0-9-]*\.myshopify\.com$`, so credentials can never be sent to any other host. "Test connection" fetches a token and shows the shop name and the scopes actually granted. Secrets are never shown again.
2. **Choose location.** The app lists the store's locations. The owner picks one. The choice is stored and shown on every screen that uses stock.
3. **Sync.** A "Sync from Shopify" button queues a `shopify.sync` job on the worker. It pages through products and variants and reads `available` at the chosen location. It upserts by variant GID, marks variants that no longer exist as removed, and is safe to run repeatedly. Progress and the last result are shown.
4. **Rate limits.** Read `throttleStatus` from every response. Wait before the next call when the bucket is low. On a throttled reply, retry with backoff up to a limit. Keep each query's cost well below 1,000.
5. **Errors in plain English.** A rejected or expired credential marks the connection `needs_reconnect` and shows "Shopify rejected the saved connection. Reconnect Shopify." A network failure shows "Can't reach Shopify right now. Try again in a few minutes." No raw errors, tokens or secrets reach the screen or logs.
6. **Warnings the owner needs (read from Shopify, shown on each variant).** Inventory tracking off: "Shopify is not tracking stock for this item, so quantity changes will have no effect." Continue selling when out of stock on: "This item keeps selling at 0." Neither is changed by the app.
7. **Screens.** Settings > Shopify (connect, test, choose location, sync, last sync result). A searchable, filterable variants list (title, SKU, options, available, warnings). The sidebar "Settings" item becomes live.

## Phase B contract (built with `proposals`, not now)

`setAvailable({ inventoryItemId, locationId, quantity, expectedCurrent, idempotencyKey, proposalId })` calls `inventorySetQuantities` with `name: "available"`, `reason`, `referenceDocumentUri` pointing at the proposal, `changeFromQuantity: expectedCurrent` and `@idempotent(key: idempotencyKey)`.
- `CHANGE_FROM_QUANTITY_STALE` is a **conflict shown to the owner**, never retried automatically and never overwritten.
- A retry after a network failure reuses the same idempotency key, so one approval can never apply twice.
- Only an approved proposal can trigger it. The function takes no quantity from anywhere else.

## Project structure

```
packages/shopify/        client, token provider, GraphQL queries, sync logic (no web or database code)
packages/db/             new tables and migration
packages/queue/          shopify.sync job added to the typed job list
apps/api/src/routes/     /api/shopify/* routes
apps/worker/             shopify.sync handler
apps/web/src/            Settings > Shopify page, variants list
```

API: `POST /api/shopify/connection`, `GET /api/shopify/connection` (never returns secrets), `POST /api/shopify/test`, `GET /api/shopify/locations`, `PUT /api/shopify/location`, `POST /api/shopify/sync`, `GET /api/shopify/sync`, `GET /api/shopify/variants?search=&page=`. All require a signed-in owner.

## Commands

Same as the foundation: `npm run check`, `npm run test:e2e`, `npm run db:migrate`. No new tooling.

## Code style

Same conventions as the foundation. The Shopify package exposes small typed functions, validates every response with Zod before use, and never returns raw GraphQL errors to callers.

## Testing strategy

All work test-first.
- **Unit:** domain validation (accepts `x.myshopify.com`, rejects `evil.com`, `x.myshopify.com.evil.com`, paths and ports); token provider (fetches, caches, refreshes ahead of expiry using a fake clock, single refresh under concurrent calls); throttle wait calculation; error classification; response parsing.
- **Fake Shopify server** (small Fastify app in tests): token endpoint, a GraphQL endpoint with paging, cost and throttle simulation, rejected credentials, and user errors. The sync and the client are tested against it.
- **Integration (real PostgreSQL):** sync upserts and is repeatable, marks removed variants, stores credentials encrypted (the stored value never contains the plaintext), the API never returns secrets, routes require a session, location choice persists.
- **Component and browser tests:** the Settings page (plain-English errors, secret field never prefilled, location picker, sync progress) and the variants list, plus the accessibility scan.
- **Manual contract check against a development store**, recorded in the PR. Required before Phase A is called done, because a fake server proves our code, not Shopify's behaviour.

## Boundaries

- **Always:** pin the API version, validate every Shopify response, encrypt credentials, redact secrets in logs, test against the fake server first.
- **Ask first:** adding or widening an access scope, changing the API version, adding a dependency, any new Shopify write.
- **Never:** write to Shopify in Phase A, store or log a token or secret, send credentials to a host other than `*.myshopify.com`, change tracking or "continue selling" settings, touch another location, retry a stale-quantity conflict automatically.

## Success criteria

1. With the fake server, connect, test, choose a location and sync end to end, and the variants appear with stock.
2. The same flow works once against a real development store, shown in the PR.
3. A request with a bad domain is rejected before any network call.
4. Tokens refresh before they expire without user action, and only one refresh happens under concurrent use.
5. Rejected credentials move the connection to `needs_reconnect` with a plain message, and a reconnect restores sync.
6. A throttled response is retried with backoff and the sync finishes.
7. Stored credentials contain no plaintext, and no secret appears in any API response, log or audit event.
8. The app's granted scopes, as reported by Shopify, contain no write scope, and the code contains no Shopify write call.
9. Variants with tracking off or "continue selling" on show their warning.
10. `npm run check` and the browser tests pass, including the accessibility scan.

## Open Questions for the owner

1. **Which credential do you have?** Can you create an app in the Dev Dashboard under the same organization as your store? Or do you already have a legacy custom app with a permanent token?
2. **Do you have a development store** to test against? If not, I'd suggest creating one, free through Shopify, so no test ever touches the live shop.
3. **Read-only first**, adding write permission at Phase B (assumption 3). Do you agree?
4. **Roughly how many variants does your store have?** Under a few thousand means plain paging is fine.
5. **Which location** should receive updates? This is chosen in the app and does not block the build.
