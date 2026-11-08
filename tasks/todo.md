# Tasks: shopify (Phase A, read-only)

Every task is test-first (red, green, refactor). Run `npm run check` before marking a task done. One branch and one PR per task, with a detailed description. Before writing a Shopify query, read the 2026-10 reference page for it.

## Task 1: Shopify domain check and error vocabulary
**Description:** In a new `packages/shopify`, a validator that accepts only `*.myshopify.com` shop domains, and a small set of typed Shopify errors with plain-English messages (rejected credentials, no access, throttled, cannot reach Shopify, unexpected reply).
**Acceptance criteria:**
- [x] Accepts `my-store.myshopify.com`. Rejects `evil.com`, `x.myshopify.com.evil.com`, `https://x.myshopify.com`, paths, ports, uppercase tricks, empty and very long input
- [x] Each error type carries a code and a message safe to show the owner, with no raw upstream text
- [x] `packages/shopify` exists in the workspace and is imported by tests
**Verification:** `npm run test:unit`
**Dependencies:** None
**Files:** `packages/shopify/package.json`, `src/domain.ts`, `src/errors.ts`, two test files
**Scope:** Small

**Status:** done 2026-11-08. The domain check runs on the original text and lower-cases afterwards, because a Kelvin sign (U+212A) lower-cases to a plain `k`. Surrounding spaces and capital letters are accepted and normalised, since the owner may paste either.

## Task 2: Token provider and the fake Shopify server
**Description:** A provider that returns a valid access token. For `client_credentials` it requests one from the shop's `/admin/oauth/access_token`, caches it in memory, refreshes about 10 minutes before expiry, and shares one in-flight refresh between concurrent callers. For `static_token` it returns the stored token. Also builds the test-only fake Shopify server (token endpoint first).
**Acceptance criteria:**
- [x] Fetches a token with the client ID and secret, and reuses it until the refresh window
- [x] Refreshes ahead of expiry (fake clock). Ten concurrent calls cause one request
- [x] Rejected credentials raise the "rejected credentials" error. A network failure raises "cannot reach Shopify"
- [x] A static token works without any request. No token or secret appears in any error message or log
- [x] The base URL can be replaced through an injected function, and the domain check still runs first
**Verification:** `npm run test:unit`
**Dependencies:** 1
**Files:** `src/token-provider.ts`, `src/base-url.ts`, `test/fake-shopify.ts`, tests
**Scope:** Medium

**Status:** done 2026-11-08. Request and reply shapes come from Shopify's "Authenticate an app for stores in your organization" and "Access tokens" pages. Not stated by Shopify, so unverified until Task 11: the status and body for wrong credentials, and the status for the different-organization error (matched by its exact message text). Two error codes were added: `invalid_shop` and `wrong_organization`.

## Task 3: GraphQL client with version pinning and throttle handling
**Description:** A client that posts GraphQL to the pinned API version (`2026-10`, one constant) with the access token header, reads `extensions.cost.throttleStatus`, waits before the next call when the bucket is low, retries throttled replies with backoff, and validates every response with Zod.
**Acceptance criteria:**
- [x] Every request names the pinned version and sends the token header
- [x] A low bucket delays the next request by the computed wait. A throttled reply is retried with backoff up to a limit, then raises the "throttled" error
- [x] 401 or 403 raises "rejected credentials" or "no access". GraphQL `errors` and network failures map to typed errors
- [x] A response that does not match its schema raises "unexpected reply" and never returns partial data
- [x] Waits and backoff use an injectable clock, so tests are fast
**Verification:** `npm run test:unit`
**Dependencies:** 2
**Files:** `src/client.ts`, `src/throttle.ts`, `src/version.ts`, tests, fake server additions
**Scope:** Medium

**Status:** done 2026-11-08. Shapes come from Shopify's GraphQL endpoint, rate-limit and response-code pages. **The wait calculation is our own inference** (points missing divided by the refill rate), because Shopify gives no formula, only a recommended one-second backoff. Not stated by Shopify, so unverified until Task 11: whether error replies carry cost data, the exact HTTP status for an invalid GraphQL token (401 is assumed), and whether `variables` is accepted (standard GraphQL, but the pages show only `query`). One error code added: `store_unavailable` (frozen, locked or inactive store).

## Task 4: Locations, catalog queries and sync logic
**Description:** Queries for locations and for products with variants and `available` quantity at one location, paged by cursor. A `syncCatalog` function that takes a client, a location and a storage interface, and reports added, updated and removed counts.
**Acceptance criteria:**
- [x] Lists locations (id, name, active)
- [x] Reads all variants across pages, with product title, variant title, option values, SKU, inventory item id, `tracked`, `inventoryPolicy` and `available` at the chosen location
- [x] Query cost stays well under 1,000 and page size is a constant
- [x] A second run with no changes reports zero changes. A variant missing from Shopify is reported as removed, not deleted
- [x] A variant not stocked at the chosen location has `available` empty, not 0
**Verification:** `npm run test:unit`
**Dependencies:** 3
**Files:** `src/queries.ts`, `src/schemas.ts`, `src/sync.ts`, tests, fake server additions
**Scope:** Medium

**Status:** done 2026-11-08. Field names come from the 2026-10 reference pages for `productVariants`, `ProductVariant`, `InventoryItem`, `InventoryLevel`, `InventoryQuantity`, `locations`, `Location`, `ProductVariantInventoryPolicy` and `SelectedOption`. No page states a query cost or a page-size limit, so the page size (50) is a constant and the cost estimate (2 + 8 per variant) is our own inference. Unverified until Task 11: that `locations` works with only `read_locations` or `read_inventory`, that `hasNextPage` exists on `PageInfo` for these connections (standard, but not stated on the pages read), and what `inventoryLevel` returns for an unstocked item (we treat null and a missing `available` as empty).

### Checkpoint: after Task 4
- [x] `npm run check` passes
- [x] The fake server's shapes are traced to the official 2026-10 reference pages, listed in the PR
- [ ] Review with owner before continuing

## Task 5: Database tables and encrypted repositories
**Description:** Migration for `shopify_connection`, `shopify_variants` and `shopify_sync_runs`. Repository functions to save and load the connection (credentials encrypted with the `crypto` package) and to upsert variants, mark removed ones, and record sync runs.
**Acceptance criteria:**
- [x] Migrations apply from empty, and the restricted app role can use the new tables
- [x] The stored credentials never contain the plaintext secret, client ID or token (queried straight from the table)
- [x] Saving a second connection replaces the first. There is only ever one
- [x] Upserting the same variants twice changes nothing. A missing variant gets `removed_at`, and returns if it reappears
**Verification:** `npm run test:integration`
**Dependencies:** 1
**Files:** `packages/db/src/schema.ts`, one migration, `packages/shopify/src/repository.ts`, tests
**Scope:** Medium

**Status:** done 2026-11-08. The repository lives in `packages/db` (not `packages/shopify` as first listed), so the Shopify package stays free of database code, as the spec's structure says. It implements the `CatalogStore` interface from Task 4. The database itself enforces the one-connection rule and "only one sync running at a time" (a partial unique index). A sync run left running for over 30 minutes is closed as interrupted when the next one starts.

## Task 6: Sync job and worker handler
**Description:** Add the `shopify.sync` job to the typed job list and a worker handler that loads the connection, runs `syncCatalog`, writes the variants and a sync run record, and moves the connection to `needs_reconnect` when credentials are rejected.
**Acceptance criteria:**
- [x] Enqueuing `shopify.sync` makes the worker sync a fake store into the database
- [x] The sync run records start, finish, counts and a plain-English error on failure
- [x] Rejected credentials set status `needs_reconnect`. A later successful sync sets it back to `connected`
- [x] Two sync requests at once do not run twice at the same time
- [x] No secret or token appears in the job payload, logs or run record
**Verification:** `npm run test:integration`
**Dependencies:** 4, 5
**Files:** `packages/queue/src/jobs.ts`, `apps/worker/src/shopify-sync.ts`, `apps/worker/src/worker.ts`, tests
**Scope:** Medium

**Status:** done 2026-11-08. The `SHOPIFY_BASE_URL_OVERRIDE` test seam and its refusal to start in production were built here (the worker is the first user), so Task 7 only has to reuse `config.shopifyBaseUrlOverride`. The `shopify.sync` job payload is strictly empty. Unexpected errors are recorded and logged but not thrown, so the queue does not retry them. Progress is stored in the run's `total` while it runs. The Dockerfile now copies `packages/shopify/package.json` (this only helps layer caching; the image built and loaded without it, so it was not a deployment bug). ESLint now allows unused parameters that start with an underscore.

## Task 7: API routes
**Description:** The `/api/shopify/*` routes from the spec: save and read the connection, test it, list locations, choose a location, start a sync, read sync status, and list variants with search and paging.
**Acceptance criteria:**
- [x] All routes need a signed-in owner
- [x] No response, log or audit event ever contains the client secret, client ID or a token. The connection read returns only shop, credential type, scopes, location, status and times
- [x] A bad domain is rejected with a plain message before any network call
- [x] "Test connection" returns the shop name and the granted scopes, and warns in plain English if any write scope is present
- [x] Saving, testing and choosing a location write audit events
- [x] `SHOPIFY_BASE_URL_OVERRIDE` is honoured only from server config, and the app refuses to start with it set in production
- [x] Variants list supports search by title or SKU, paging, and returns the tracking and "continue selling" warnings
**Verification:** `npm run test:integration`
**Dependencies:** 3, 5, 6
**Files:** `apps/api/src/routes/shopify.ts`, `apps/api/src/app.ts`, `packages/shared/src/config.ts`, tests
**Scope:** Medium

**Status:** done 2026-11-08. The permission list comes from `currentAppInstallation { accessScopes { handle } }` (field names read on shopify.dev), and the shop name from `shop { name }`. A legacy permanent token is accepted too. The permission query is best effort: if Shopify will not answer it, the connection still works and the owner is told the permissions could not be checked. A write permission counts as also allowing reads, as Shopify states. Saving is allowed with missing read permissions (with a warning) so the owner can fix it in Shopify and reconnect. Added `isSyncRunning` (ignores a run stuck for over 30 minutes) so a crashed sync cannot block the Sync button. Not verified until Task 11: the access scope `currentAppInstallation` needs, and any scope `shop` needs (neither page states one).

### Checkpoint: after Task 7
- [x] `npm run check` passes
- [x] A test proves the code contains no Shopify write call, and the requested scopes contain no write scope
- [ ] Review with owner before continuing

## Task 8: Settings > Shopify page and a small router
**Description:** A tiny History-API router, then the Settings > Shopify page: connect form, test connection, location picker, sync button with progress and last result, and reconnect. UI work: use `ui-ux-pro-max` and `design-taste-frontend`, the design system, and look at screenshots.
**Acceptance criteria:**
- [x] Sidebar "Settings" becomes a live link. The router handles back, forward and deep links
- [x] The secret field is never prefilled and is cleared after saving. Errors are plain English, beside the field
- [x] Location picker, sync progress and the last sync result are shown. "Reconnect Shopify" appears when the connection needs it
- [x] Keyboard and screen reader friendly, and passes the accessibility scan in light and dark
- [x] Looks right at desktop and phone sizes (checked with screenshots)
**Verification:** `npm run test:unit`, `npm run build`, screenshots reviewed
**Dependencies:** 7
**Files:** `apps/web/src/router.tsx`, `pages/SettingsShopifyPage.tsx`, `api.ts`, `shell/AppShell.tsx`, tests
**Scope:** Medium

**Status:** done 2026-11-08. The router is the browser's own history (no library); unknown addresses show a "Page not found" page, and after moving to another page keyboard focus moves to the page content. The Settings page is `/settings/shopify` (`/settings` is an alias). Reconnecting keeps the store address but never the client id, secret or token. After a sync the connection is read again, because its status may have changed. If a sync never starts, the page says the background worker may not be running after about 30 seconds. Checked with screenshots of 12 states (desktop light and dark, phone) and an automated accessibility scan of each: no violations. Browser tests through the whole stack with a fake Shopify are Task 10.

## Task 9: Products list
**Description:** The Products page: a searchable, filterable table of imported variants (product, variant, options, SKU, available), with the tracking and "continue selling" warnings, an empty state that points to Settings, and a card layout on phones.
**Acceptance criteria:**
- [ ] Sidebar "Products" becomes live
- [ ] Search by title or SKU, a filter for items with warnings, paging
- [ ] Warnings use words, not colour alone
- [ ] Empty state: "No products yet. Connect Shopify in Settings."
- [ ] Table is readable on a phone, and passes the accessibility scan
**Verification:** `npm run test:unit`, screenshots reviewed
**Dependencies:** 7, 8
**Files:** `pages/ProductsPage.tsx`, `components/DataTable.tsx`, `api.ts`, tests
**Scope:** Medium

## Task 10: Browser tests through the real stack
**Description:** Extend `e2e/stack.ts` with the fake Shopify server and drive the full journey in a real browser.
**Acceptance criteria:**
- [ ] Journey: sign in, connect with fake credentials, test, choose a location, sync, see the variants
- [ ] Rejected credentials show "Reconnect Shopify" and a reconnect restores sync
- [ ] No secret is visible in the page, network responses or console
- [ ] Runs on desktop and phone sizes in CI, including the accessibility scan
**Verification:** `npm run test:e2e`
**Dependencies:** 8, 9
**Files:** `e2e/stack.ts`, `e2e/shopify.spec.ts`, `e2e/fake-shopify-server.ts`
**Scope:** Medium

### Checkpoint: after Task 10
- [ ] `npm run check` and `npm run test:e2e` pass in CI
- [ ] Review with owner before continuing

## Task 11: Real development-store check and wrap-up
**Description:** Run the whole flow once against a real Shopify development store and record the result. Confirm the open points from the spec (the scope the `locations` query needs, field names in 2026-10, organization match). Fix the fake to match what Shopify really returns. Update `docs/deployment.md`.
**Acceptance criteria:**
- [ ] Real connection, location choice, sync and Products list work against a development store, shown in the PR (sensitive values hidden)
- [ ] The scopes Shopify reports contain no write scope
- [ ] Differences between the fake and the real responses are fixed, with tests
- [ ] `docs/deployment.md` explains creating the Dev Dashboard app, the scopes to request, and the quarterly API version check
- [ ] The spec's "not yet verified" list is updated with the findings
**Verification:** manual run, recorded in the PR; `npm run check`
**Dependencies:** 10, and a development store plus credentials from the owner
**Files:** `docs/deployment.md`, `SPEC-shopify.md`, tests and fakes as needed
**Scope:** Small to medium

### Checkpoint: Phase A complete
- [ ] All ten success criteria in `SPEC-shopify.md` met
- [ ] `npm run check` and `npm run test:e2e` pass
- [ ] Review with owner, then write `SPEC-mapping.md`
