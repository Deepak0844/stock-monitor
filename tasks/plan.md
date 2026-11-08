# Implementation Plan: shopify (Phase A, read-only)

Spec: `SPEC-shopify.md` (approved 2026-11-08, defaults used for its open questions). Map: `CAPABILITY-MAP.md`. Tasks: `tasks/todo.md`. The finished foundation plan is archived in `tasks/foundation-plan.md`.

## Overview
Connect the app to the owner's Shopify store with **read-only** permissions, choose one inventory location, import products and variants with current `available` stock, and show them in a searchable list. Phase B (applying an approved change) is built later with the `proposals` module and is not part of this plan.

## Architecture decisions
- **New package `packages/shopify`.** The client, token handling, queries and sync logic live there with no web or database code, so each part is unit tested against a fake Shopify server.
- **Build against a fake Shopify server first.** The fake's response shapes come from the official 2026-10 reference pages read during each task. A manual check against a real development store (Task 11) proves the shapes, because a fake proves our code and not Shopify's behaviour.
- **Credentials never leave the server.** Client ID and secret are stored AES-GCM encrypted. Access tokens (24-hour lifetime) live in memory only and refresh about 10 minutes before expiry, one refresh at a time.
- **Host allow-list.** The shop domain must match `*.myshopify.com`, checked before any request, so credentials cannot be sent elsewhere.
- **Test seam for the base URL.** Tests and the browser-test stack need Shopify requests to go to a fake server. A server-side setting `SHOPIFY_BASE_URL_OVERRIDE` replaces the base URL only. The domain check still runs, the value is never read from a user request, and the app refuses to start if it is set in production.
- **Sync is a background job** (`shopify.sync`, on the existing queue). It is safe to run repeatedly and marks missing variants as removed instead of deleting them.
- **A tiny router arrives here**, because Settings and Products are the first pages after the Dashboard. Plain History API, no library.
- **Read-only is enforced twice:** the requested scopes contain no write scope, and a test fails if the code contains a Shopify mutation.

## Dependency graph
```
1 domain + errors
 └─ 2 token provider (+ fake Shopify server)
     └─ 3 GraphQL client (version, throttle, retries)
         └─ 4 locations + catalog queries + sync logic
5 database tables + encrypted repositories (needs 1)
 6 sync job + worker handler (needs 4, 5)
  7 API routes (needs 3, 5, 6)
   8 Settings > Shopify page + router (needs 7)
   9 Products list (needs 7, 8)
    10 browser tests through the real stack (needs 8, 9)
     11 real development-store check, docs, wrap-up (needs 10; needs the owner's store)
```

## Task list
See `tasks/todo.md`. Order: 1 to 11, with checkpoints after Tasks 4, 7 and 10.

## Risks and mitigations
| Risk | Impact | Mitigation |
|---|---|---|
| Owner's store and app are not in the same Shopify organization, so the client-credentials grant is refused | High | Spec allows a legacy permanent token as a second credential type. Task 2 supports both. Task 11 finds out early what the owner has. |
| No development store is available | High | Task 11 is blocked until one exists. Tasks 1 to 10 do not need it. Creating a free one is the recommendation in the spec. |
| Real Shopify response shapes differ from the fake | High | Fake shapes come from the 2026-10 reference pages, every response is validated with Zod, and Task 11 runs the real flow and records it in the PR. |
| Throttling stalls a large sync | Medium | Read `throttleStatus`, wait before the next call, back off on throttled replies, keep each query's cost low. Plain paging is enough for a few hundred variants. |
| The `locations` query needs a scope not yet requested | Medium | Confirmed in Task 11. Task 7 reports missing scopes in plain English. |
| Secret leak through logs or API responses | High | Tests assert no plaintext in the database, API responses or logs. Redaction already covers secret-like keys. |
| API version retires (2026-10 supported to 2027-10-16) | Low | One constant, and a note in `docs/deployment.md` to check quarterly. |
| Phase B needs `write_inventory`, which means a new app version the owner must approve | Low | Documented now so it is no surprise later. |

## Open questions
The five spec questions are still unanswered, and the spec's defaults apply: Dev Dashboard app in the same organization, read-only first, a few hundred variants, location chosen in the app. Tasks 1 to 10 do not depend on the answers. **Task 11 needs a development store and credentials from the owner.**
