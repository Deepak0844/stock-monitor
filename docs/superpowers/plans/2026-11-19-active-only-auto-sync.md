# Active Products Only + Automatic Shopify Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync reads only active products, and Shopify change messages (webhooks) start a grouped full sync by themselves.

**Architecture:** One inline filter on the existing variants query. A public, signature-checked API route queues the
existing `shopify.sync` job through pg-boss `sendDebounced`. The worker signs up for the four webhook topics after each
successful sync, from one new file that is the only allowed exception to the read-only rule besides the stock write.

**Tech Stack:** TypeScript, Fastify, pg-boss ^12, Shopify Admin GraphQL 2026-10, Vitest, npm workspaces.

**Spec:** `docs/superpowers/specs/2026-11-19-active-only-auto-sync-design.md`

## Global Constraints

- Branch `feature/shopify-auto-sync` off `develop`. Do not touch the owner's `.env`. No Claude attribution in commits or PRs.
- npm, not pnpm. Run tests with `npx vitest run <path>`.
- Filter string, exact: `product_status:active`.
- Topics, exact: `PRODUCTS_CREATE`, `PRODUCTS_UPDATE`, `PRODUCTS_DELETE`, `INVENTORY_LEVELS_UPDATE`.
- Webhook path, exact: `/api/shopify/webhooks`. Callback URL: `${appOrigin}/api/shopify/webhooks`, only when `appOrigin` starts with `https://`.
- Grouping window: 60 seconds, key `"shopify.sync"`.
- Auto sync only for `client_credentials` connections; `static_token` keeps manual Sync only.
- Only `packages/shopify/src/webhook-subscribe.ts` may add a mutation, and only `webhookSubscriptionCreate`.

## Review Focus

1. A webhook for a product with many variants is over Fastify's 1 MB default body limit → must still get 200 (route `bodyLimit` 5 MB). Test in Task 4.
2. Missing, empty or wrong-length `X-Shopify-Hmac-Sha256` → 401, never a 500 (`timingSafeEqual` throws on length mismatch). Test in Task 4.
3. Shopify keeps sending after the owner disconnects, or the connection is a static token → 401, nothing queued. Test in Task 4.
4. A burst of changes → at most two `shopify.sync` jobs waiting. Test in Task 2.
5. A follow-up sync starts while a long sync is still running → it re-queues itself grouped instead of being dropped. Test in Task 3.

---

### Task 0: Branch

- [ ] **Step 1:** Create a worktree on a new branch so the current checkout's uncommitted work stays put:
  `git fetch origin && git worktree add ../stock-monitor-auto-sync -b feature/shopify-auto-sync origin/develop`, then `npm ci` there.
- [ ] **Step 2:** Move `docs/superpowers/specs/2026-11-19-active-only-auto-sync-design.md` and this plan into the worktree, commit: `docs: design and plan for active-only products and auto sync`.

### Task 1: Read only active products

**Files:**
- Modify: `packages/shopify/src/catalog.ts` (`VARIANTS_QUERY`)
- Modify: `packages/shopify/test/fake-catalog.ts` (`FakeVariant`, variants handler)
- Test: `packages/shopify/src/catalog.test.ts`, `packages/shopify/src/sync.test.ts`

**Interfaces:**
- Produces: `FakeVariant.status?: "ACTIVE" | "DRAFT" | "ARCHIVED" | "UNLISTED"` (missing = `"ACTIVE"`). The fake honours `product_status:active` only when the query text contains it.

- [ ] **Step 1: Failing tests**
  - `catalog.test.ts` › `"reads only active products"`: variants 1 (default), 2 `status: "DRAFT"`, 3 `status: "ARCHIVED"`, 4 `status: "UNLISTED"` → collected ids equal `[variant 1 id]`; and `store.catalog.queries.join(" ")` matches `/product_status:active/`.
  - `sync.test.ts` › `"a product moved to draft is marked removed, and comes back when active again"`: sync with variant 1 active → `removed: 0`; set variant 1 to `DRAFT`, sync → `removed: 1`; set back to `ACTIVE`, sync → `updated: 1`, stored `removed: false`.
- [ ] **Step 2:** `npx vitest run packages/shopify/src/catalog.test.ts packages/shopify/src/sync.test.ts` → the new tests FAIL.
- [ ] **Step 3:** Add `query: "product_status:active"` inline to `productVariants(...)` in `VARIANTS_QUERY` (a literal, not a variable). Builder: confirm `product_status` is a listed productVariants filter for 2026-10 on shopify.dev. Add `status` to `FakeVariant` and filter in the fake's variants branch.
- [ ] **Step 4:** Re-run → PASS, and `npx vitest run packages/shopify` all green.
- [ ] **Step 5:** Commit `feat: read only active Shopify products`.

### Task 2: Grouped enqueue

**Files:**
- Modify: `packages/queue/src/queue.ts`
- Test: `apps/worker/test/shopify-sync.int.test.ts` (has a real database and `createQueue`)

**Interfaces:**
- Produces: `JobOptions.groupSeconds?: number`. When set, `enqueue` calls `boss.sendDebounced(name, data, otherOptions, groupSeconds, name)`; otherwise unchanged `boss.send`.

- [ ] **Step 1: Failing test** `"grouped sends never leave more than two syncs waiting"`: with a started real queue (no worker for `shopify.sync`), call `enqueue("shopify.sync", {}, { groupSeconds: 60 })` 5 times → `select count(*) from pgboss.job where name = 'shopify.sync' and state = 'created'` is `2`. (Check the schema/table name pg-boss 12 uses.)
- [ ] **Step 2:** Run `npx vitest run apps/worker/test/shopify-sync.int.test.ts -t "grouped"` → FAIL (5 rows).
- [ ] **Step 3:** Implement in `queue.ts`.
- [ ] **Step 4:** Re-run → PASS.
- [ ] **Step 5:** Commit `feat: queue can group repeated sends into one slot`.

### Task 3: Worker — follow-up when busy, and webhook sign-up

**Files:**
- Create: `packages/shopify/src/webhook-subscribe.ts` (export from `index.ts`)
- Modify: `packages/shopify/test/fake-catalog.ts` (answer `webhookSubscriptions` and `webhookSubscriptionCreate`; record created `{ topic, uri }`)
- Modify: `packages/shopify/src/read-only.test.ts`
- Modify: `apps/worker/src/shopify-sync.ts`, `apps/worker/src/index.ts`
- Test: `packages/shopify/src/webhook-subscribe.test.ts`, `apps/worker/test/shopify-sync.int.test.ts`, `apps/worker/src/shopify-sync.test.ts` (new, pure)

**Interfaces:**
- Produces: `WEBHOOK_TOPICS` (the four topics, `as const`); `ensureWebhookSubscriptions(client: ShopifyClient, uri: string): Promise<{ created: string[] }>`; `webhookUrlFor(appOrigin: string | undefined): string | undefined` in `apps/worker/src/shopify-sync.ts`.
- `ShopifySyncDeps` gains `queue?: Pick<Queue, "enqueue">` and `webhookUrl?: string`.
- GraphQL (2026-10): read `webhookSubscriptions(first: 50) { nodes { id topic uri } }`; write `mutation WebhookCreate($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) { webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) { webhookSubscription { id } userErrors { field message } } }` with `$sub = { uri, format: "JSON" }`. Builder: check field names on shopify.dev; older versions used `callbackUrl`.

- [ ] **Step 1: Failing tests**
  - `webhook-subscribe.test.ts`: `"creates all four when none exist"` → `created` equals `WEBHOOK_TOPICS`, fake recorded four with the given uri; `"creates only the missing ones"` (fake already has `PRODUCTS_UPDATE` at the same uri) → three; `"a topic pointing elsewhere does not count"` → four created; `"userErrors become an unexpected_reply ShopifyError"`.
  - `read-only.test.ts`: the second allowed file is `webhook-subscribe.ts`; it contains exactly one `mutation`, its only write operation is `webhookSubscriptionCreate`, and it names no operation from `WRITE_OPERATIONS`.
  - `shopify-sync.test.ts`: `webhookUrlFor("https://a.sslip.io")` → `"https://a.sslip.io/api/shopify/webhooks"`; `webhookUrlFor("http://localhost:3000")` and `webhookUrlFor(undefined)` → `undefined`.
  - `shopify-sync.int.test.ts`: `"a sync that finds one running queues a grouped follow-up"` (spy queue records `("shopify.sync", {}, { groupSeconds: 60 })`); `"a successful sync signs up for change messages"` (webhookUrl set, client_credentials → fake has four); `"a static-token connection does not sign up"`; `"a failed sign-up still finishes the sync as succeeded"` (fake answers the subscriptions query with an error → run `succeeded`, a warn log line).
- [ ] **Step 2:** Run those files → FAIL.
- [ ] **Step 3:** Implement. In the handler: `startSyncRun()` null → `await deps.queue?.enqueue("shopify.sync", {}, { groupSeconds: 60 })`, log, return. After `finishSyncRun(... "succeeded")`: when `deps.webhookUrl` and `saved.credentials.type === "client_credentials"`, call `ensureWebhookSubscriptions` in try/catch, log `created` at info, errors at warn. In `index.ts` pass `queue` and `webhookUrl: webhookUrlFor(config.appOrigin)`; log once at startup when it is undefined ("auto sync is off: APP_ORIGIN must be https").
- [ ] **Step 4:** Re-run → PASS; `npx vitest run packages/shopify apps/worker` green.
- [ ] **Step 5:** Commit `feat: worker signs up for Shopify change messages and never drops a sync`.

### Task 4: Webhook route

**Files:**
- Create: `packages/shopify/src/webhook-hmac.ts` (export from `index.ts`), `apps/api/src/routes/shopify-webhooks.ts`
- Modify: `apps/api/src/app.ts` (`PUBLIC_ROUTES` + register the route with the Shopify deps)
- Test: `packages/shopify/src/webhook-hmac.test.ts`, `apps/api/test/shopify.int.test.ts`

**Interfaces:**
- Produces: `verifyShopifyHmac(rawBody: Buffer, header: string | undefined, secret: string): boolean` — base64 HMAC-SHA256, `timingSafeEqual`, `false` (never throw) on missing/empty/wrong-length header.
- Route uses `ShopifyRoutesDeps` (`repo.getCredentials()`, `queue.enqueue`). Registered inside its own `app.register(...)` scope with `addContentTypeParser("application/json", { parseAs: "buffer" }, ...)` so the rest of the API keeps JSON parsing. Route `bodyLimit: 5 * 1024 * 1024`.

- [ ] **Step 1: Failing tests**
  - `webhook-hmac.test.ts`: right signature → true; one byte changed in body → false; header `undefined`, `""`, `"abc"` → false, no throw.
  - `shopify.int.test.ts` (connect first with `connectBody`; sign with `SECRET`; no cookie): `"a signed change message queues one grouped sync"` → 200, `queued` has `{ name: "shopify.sync" }` and options `{ groupSeconds: 60 }` (extend the test queue stub to record options); `"a wrong signature is refused"` → 401, nothing queued; `"a missing signature is refused"` → 401; `"another shop's message is refused"` (header `X-Shopify-Shop-Domain: other.myshopify.com`) → 401; `"refused when not connected"` → 401; `"refused for a static-token connection"` → 401; `"a 2 MB message is accepted"` → 200; `"other API routes still parse JSON"` (an existing JSON POST still works after registration).
- [ ] **Step 2:** `npx vitest run packages/shopify/src/webhook-hmac.test.ts apps/api/test/shopify.int.test.ts` → FAIL.
- [ ] **Step 3:** Implement. Order: credentials missing or not `client_credentials` → 401; shop header ≠ saved shop → 401; bad signature → 401; else enqueue grouped and reply 200 `{ ok: true }`. Log refusals at warn without body or headers' secret values.
- [ ] **Step 4:** Re-run → PASS. Then `npm run lint`, `npm run typecheck` (or the repo's equivalents in root `package.json`), and `npx vitest run` → all green.
- [ ] **Step 5:** Commit `feat: Shopify change messages start an automatic sync`.

### Task 5: Finish

- [ ] **Step 1:** Add a short "Automatic sync" section to `docs/google-cloud.md` (or the README section that covers Shopify): needs `APP_ORIGIN` https and a client ID + secret connection; first manual Sync after deploy signs up.
- [ ] **Step 2:** Full verification: `npx vitest run` green; paste the summary in the PR.
- [ ] **Step 3:** Push, open a detailed PR to `develop`. Do not merge until the owner says "merge".
