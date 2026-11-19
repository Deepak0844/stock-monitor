# Active products only + automatic Shopify sync — design

Date: 2026-11-19. Size: small change (one PR).

## Why
The app reads every product, drafts and archived included, so draft items get mapped, checked against suppliers
and get stock proposals. And syncing only happens when the owner presses Sync (or after an approved write), so
the app's Shopify numbers go stale between presses.

## Goals
- Read only products whose status is **active**.
- Sync by itself when Shopify reports a change to a product (create, edit, status change, delete) or to a stock level.

## Non-goals / anti-goals
- No per-item updates from the change message (approach B, rejected). Every trigger runs the existing full sync.
- No timer-based sync.
- A burst of changes (many sales) must never start a burst of syncs.
- A change arriving mid-sync must never be lost.

## Approaches
- **A. Change message → grouped full sync (picked by owner).** Reuses the tested `shopify.sync` job; cannot drift. A sync takes a minute or two.
- B. Change message → update only that row. Faster, much more code, Shopify messages can come out of order, repeat or go missing, so full syncs are still needed.
- C. Sync on a timer. Dropped: owner asked for "when Shopify changes".

## Design
1. **Active only.** `VARIANTS_QUERY` in `packages/shopify/src/catalog.ts` passes `query: "product_status:active"` to
   `productVariants`. A product that goes to draft/archived is then "not seen" and gets the existing removed mark
   (never deleted); going active again brings it back on the next sync. Builder: confirm the filter name against
   Shopify's productVariants docs for the pinned API version.
2. **Webhook endpoint.** `POST /api/shopify/webhooks`, public (no session), added to `PUBLIC_ROUTES`. Reads the raw
   body, checks `X-Shopify-Hmac-Sha256` (base64 HMAC-SHA256 of the raw body with the saved client secret,
   constant-time compare) and that `X-Shopify-Shop-Domain` is the saved shop. Bad or unknown → 401, nothing queued.
   Good → queue a grouped sync, reply 200 fast. The body is not used beyond the check.
3. **Grouping.** Queue `shopify.sync` with pg-boss `sendDebounced` (60 s slots, one key): the first change syncs
   right away, and every further change in the next minute folds into one follow-up sync. A burst never queues more
   than two.
4. **No lost changes.** Today a sync that finds another running just returns. Instead, it leaves one follow-up sync
   queued (also grouped) so a change that landed mid-sync is read.
5. **Signing up for messages.** After each successful sync (the first one follows connecting), the app makes sure these subscriptions
   exist (list, create missing, no duplicates): `PRODUCTS_CREATE`, `PRODUCTS_UPDATE`, `PRODUCTS_DELETE`,
   `INVENTORY_LEVELS_UPDATE`, pointing at `${APP_ORIGIN}/api/shopify/webhooks`. Skipped (logged once) when
   `APP_ORIGIN` is not https, as on localhost. A failure here never fails the sync.
6. **Safety rule.** `read-only.test.ts` forbids any Shopify change except the stock write. Owner chose one narrow
   exception: a single file, `packages/shopify/src/webhook-subscribe.ts`, may hold exactly one mutation,
   `webhookSubscriptionCreate`, for the four topics above. The test is extended so that file can do nothing else.

## Builder's calls (owner: check these)
- Auto sync needs a **client ID + secret** connection: the secret signs the messages. A pasted access-token connection
  keeps manual Sync only, and the log says why.
- No new screen. The existing "last sync" line already shows when the auto syncs ran.
- The app's own approved write also sends a stock message; grouping folds it into the sync that already follows a write.
- Local tests use fake signed messages and a fake Shopify; the real flow is first seen on the live server.
