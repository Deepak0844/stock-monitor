# Quick Read Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Check stock of suppliers that need no login from a plain HTML download when it answers clearly, fall back to the browser per page, try an unloadable page 3 times, start such suppliers at a 3 s pause, and allow 15/30-minute schedules.

**Architecture:** The browser service gains `POST /quick-read`: a guarded, bounded HTTP GET whose HTML goes through the same offer reader as captures (moved to a pure `offers.ts`). The worker's stock `visit` tries it first for eligible suppliers and keeps today's browser capture as the fallback, now wrapped in a 3-try loop. Small DB, scheduling and web changes record how each page was read.

**Tech Stack:** TypeScript, Node `http`/`https`/`zlib`, Vitest, Drizzle + PostgreSQL, Fastify, Playwright, React.

**Spec:** `docs/superpowers/specs/2026-11-19-quick-read-design.md` (read first; approved by the owner).

## Global Constraints

- Public repo: no supplier names or domains anywhere. Use `shop.acme.example` / `supplier.example`.
- Commits: conventional types, NO `Co-Authored-By` or "Generated with" lines. Never merge a PR until the owner says "merge".
- No new dependency. Quick read uses Node's `http`, `https`, `zlib` only.
- Quick read limits: 5 redirects, 10 s in all, 3 MB body, `text/html` only, `user-agent: stock-monitor/1.0`, `accept-language` = `BROWSER_LANGUAGE` when set, no cookies.
- Offer caps unchanged: 100 offers, 200 characters a field, 2000 values per script, scripts over 1,000,000 characters skipped; raw script text returned by `describePage` at most 2,000,000 characters in all.
- Retries: 3 tries in all, waits 5000 ms then 15000 ms, only for `unreachable` and `service_unavailable`.
- Migration number `0023` (`0023_quick_read.sql`).
- Verification each task: `npm run typecheck && npm run lint` plus the task's tests; the last task runs `npm run check`.

## Review Focus

1. **A redirect from a public site to a private address** (`http://127.0.0.1`, `http://10.0.0.5`, a name that resolves privately): the quick read must stop with `blocked: true`, never connect. Tested in Task 2.
2. **A huge or endless response** (a 50 MB page, a server that never finishes): must stop at 3 MB or 10 s and fall back, never hold memory or the run. Tested in Task 2.
3. **A page whose built-in data says InStock but that is really a login or puzzle page** (password box, challenge widget, 401/403/429): the quick read must not answer; the browser decides. Tested in Task 2 and Task 6.
4. **A run where the browser service goes down mid-run**: each page retries twice, then cannot tell; three in a row still end the run; no retry storm beyond 3 tries a page. Tested in Task 6.
5. **Old observations and old clients**: rows with `read_by` null and a browser service without `/quick-read` (404) must fall back cleanly, never fail the check. Tested in Task 3 and Task 6.

---

### Task 1: One offer reader for both paths

**Files:**
- Create: `services/browser/src/offers.ts`, `services/browser/src/offers.test.ts`
- Modify: `services/browser/src/capture.ts` (`describePage` returns raw texts; `capturePageIn` calls `offersFrom`)
- Modify: `services/browser/test/offers.browser.test.ts` (keep 2 end-to-end cases; the rest move to `offers.test.ts`)

**Interfaces:**
- Produces: `offersFrom(jsonTexts: string[], microdata: string[], pageUrl: string): PageOffer[]` (pure, Node). `PageOffer` stays exported from `capture.ts` (re-export from `offers.ts`).
- `describePage` result gains `ldScripts: string[]` and `microdata: string[]` and loses `offers`.

- [ ] **Step 1: Write the failing tests** in `offers.test.ts`, one per case now in `offers.browser.test.ts`, calling `offersFrom([JSON.stringify(x)], [], "https://supplier.example/products/widget")`: Product with relative offer url → absolute; single offer object; ProductGroup `hasVariant` name/url/sku; `@graph`; microdata `["https://schema.org/SoldOut"]` → `[{ availability: "SoldOut", url: null, sku: null, name: null }]`; broken JSON then valid → only valid; Article/BreadcrumbList → `[]`; 500 offers → 100 and a 5000-char sku → 200; a huge first script (3000 nodes) does not starve a later Product; a script over 1,000,000 chars is skipped; no other keys kept (`secretKey`, `token`, seller name absent from `JSON.stringify(result)`).
- [ ] **Step 2: Run, expect FAIL** — `npx vitest run services/browser/src/offers.test.ts` → cannot resolve `./offers.js`.
- [ ] **Step 3: Implement.** Move the walker from `describePage` into `offersFrom` unchanged in behaviour (same caps, `valueName`, `address` resolving with `new URL(raw, pageUrl)`). `describePage` collects `script[type="application/ld+json"]` `textContent` (skip > 1,000,000; stop adding when the total passes 2,000,000) and `[itemprop=availability]` `href`/`content`. `capturePageIn` sets `description.offers = offersFrom(seen.ldScripts, seen.microdata, page.url())`. Trim `offers.browser.test.ts` to "reads a Product's offers through a real page" and "skips broken JSON"; keep `read-page.browser.test.ts` (tsx) asserting `offers` via the capture path — change the probe to call `capturePageIn`-equivalent: `offersFrom(seen.ldScripts, seen.microdata, page.url())`.
- [ ] **Step 4: Run, expect PASS** — `npx vitest run services/browser/src/offers.test.ts services/browser/test/offers.browser.test.ts services/browser/test/read-page.browser.test.ts services/browser/src`.
- [ ] **Step 5: Commit** — `git commit -am "refactor: one offer reader for captures and quick reads"` (add the new files first).

---

### Task 2: The quick read

**Files:**
- Create: `services/browser/src/quick-read.ts`, `services/browser/src/quick-read.test.ts`

**Interfaces:**
- Consumes: `Guard` (`guard.ts`), `offersFrom` (Task 1), `explainPage`/`looksLikeNotFound` (`@stock-monitor/supplier-session`).
- Produces:
  ```ts
  export type QuickReadOutcome = { result: PageClass; status: number | null; finalUrl: string | null; softNotFound: boolean; offers: PageOffer[]; signal: string; blocked: boolean };
  export type QuickReadOptions = { guard: Guard; language?: string; timeoutMs?: number; maxBytes?: number; maxRedirects?: number };
  export function quickRead(url: string, options: QuickReadOptions): Promise<QuickReadOutcome>;
  ```
  `finalUrl` without query (as captures). `softNotFound` from the decoded `<title>` via `looksLikeNotFound({ title, heading: null })`. The title itself is not returned.

- [ ] **Step 1: Write the failing tests** with a local `http.createServer` and `createGuard({ allowHosts: ["127.0.0.1"] })`:
  - a page with a JSON-LD Product `InStock` → `{ result: "ok", status: 200, offers: [{ availability: "InStock", … }], blocked: false }`, `finalUrl` without query.
  - a 302 to another path on the same server is followed (offers read from the target); a chain of 6 redirects → `{ result: "unknown", signal: "too_many_redirects" }`.
  - a redirect to a private address with a guard WITHOUT `allowHosts` for it → `{ blocked: true, result: "unknown" }` and the target server never receives a request.
  - a body over `maxBytes` (test value 10_000) → `{ result: "unknown", signal: "too_large" }`; a server that never ends with `timeoutMs: 200` → `{ result: "unreachable", signal: "timeout" }`.
  - gzip and br bodies decode (offers found).
  - `content-type: application/json` → `{ result: "unknown", signal: "not_html" }`.
  - a visible `<input type="password">` → `login_required`; `<div class="h-captcha" …>` → `captcha`; status 403 → `blocked`; 401 → `login_required`; 503 → `unreachable`.
  - "Please log in to see prices" in the body only → `ok` (public page).
  - the request sent `user-agent: stock-monitor/1.0`, `accept-language` when `language` is given, and no `cookie` header.
- [ ] **Step 2: Run, expect FAIL** — `npx vitest run services/browser/src/quick-read.test.ts`.
- [ ] **Step 3: Implement.** Per hop: `new URL`, only `http:`/`https:`; `guard.check(host, port)` → refused: return blocked; else `http(s).request` with `lookup` returning the checked address (so the connection goes to it) and `servername: host` for TLS; `accept-encoding: gzip, br, deflate`; decode with `zlib`; count bytes after decoding and abort past `maxBytes`; one `AbortSignal.timeout(timeoutMs)` for the whole read. 3xx with `location` → next hop (resolved against the current URL) up to `maxRedirects`. HTML text for `explainPage`: drop `<script>`/`<style>`/`<noscript>` blocks, strip tags, decode `&amp; &lt; &gt; &quot; &#39; &#NNN; &#xHH; &nbsp;`, collapse spaces, cap at the capture's `MAX_TEXT`. `hasPasswordField`: `<input` with `type=password` and no `type=hidden`/`hidden` attribute; `hasChallengeWidget`: class or iframe matching `h-captcha|g-recaptcha|cf-turnstile`. JSON-LD texts and microdata by bounded regexes (`/<script\b[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi`, `/itemprop=["']?availability["']?[^>]*?(?:href|content)=["']([^"']+)["']/gi` and the attribute-order mirror). `explainPage({ requestedUrl, publicPage: true, page: { finalUrl, status, title, text, hasPasswordField, hasChallengeWidget } })`.
- [ ] **Step 4: Run, expect PASS** — same command.
- [ ] **Step 5: Commit** — `git commit -am "feat: a quick read of a page's HTML through the guard"` (add new files).

---

### Task 3: `/quick-read` route and client

**Files:**
- Modify: `services/browser/src/server.ts` (`ControlServerOptions.quickRead?`, route, parse), `services/browser/src/service.ts` (wire with the service's guard and `BROWSER_LANGUAGE`), `packages/browser-client/src/client.ts` (`quickRead`), `packages/browser-client/test/fake-browser-service.ts` (`quickRead` behaviour)
- Test: `services/browser/src/server.test.ts`, `packages/browser-client/src/client.test.ts`

**Interfaces:**
- Produces (client): `quickRead(request: { url: string }): Promise<{ ok: true; result: PageClass; status: number | null; finalUrl: string | null; softNotFound: boolean; offers: PageOffer[]; blockedRequests: number } | { ok: false; reason: "failed" | "unavailable" }>` — sends `{ url, publicPage: true }`; a 404 from an older service is `{ ok: false, reason: "failed" }`.
- Fake service: `behaviour.quickRead: "ok" | "fail" | "missing"` (default `"missing"` → 404, so existing worker tests keep using `/capture`), `behaviour.quickPage` (outcome fields) and `behaviour.quickOffers`.

- [ ] **Step 1: Failing tests.** Server: needs the token; refuses a body without `publicPage: true` (400) and a non-web url (400); passes `url` to `quickRead`; logs `quick-read: <result> (<signal>) http=<status>` and never the address. Client: sends `{ url, publicPage: true }`; parses offers like capture (drops malformed); 404 → `failed`; nothing answering → `unavailable`.
- [ ] **Step 2: Run, expect FAIL** — `npx vitest run services/browser/src/server.test.ts packages/browser-client`.
- [ ] **Step 3: Implement** following the `/capture` handling (`known` list, error names in logs only).
- [ ] **Step 4: Run, expect PASS** — same command.
- [ ] **Step 5: Commit** — `git commit -am "feat: the browser service answers quick reads"`.

---

### Task 4: Database: `read_by`, 15/30-minute intervals, 3 s pause

**Files:**
- Modify: `packages/db/src/schema.ts` (`stockObservations.readBy`, check; widen `suppliers_schedule_interval` to `in (15, 30, 60, 180, 360, 720, 1440)`), `packages/db/drizzle/0023_quick_read.sql` (+ meta), `packages/db/src/observation-repository.ts` (`ObservationInput.readBy?: "quick" | "browser" | null`, record field), `packages/db/src/supplier-repository.ts` (`setNeedsLogin`)
- Test: `packages/db/test/extraction-repository.int.test.ts`, `packages/db/test/supplier-repository.int.test.ts`

- [ ] **Step 1: Failing tests.** An observation appended with `readBy: "quick"` reads back `readBy: "quick"` (listFor and latestByMapping); without it, `null`; `readBy: "other"` is refused by the database. `setSchedule` accepts 15 and 30, still refuses 20. `setNeedsLogin(id, false)` on a new supplier → `checkPauseSeconds: 3`; on one whose pause was set to 7 → stays 7; `setNeedsLogin(id, true)` after → stays 3.
- [ ] **Step 2: Run, expect FAIL** — `npx vitest run packages/db/test/extraction-repository.int.test.ts packages/db/test/supplier-repository.int.test.ts`.
- [ ] **Step 3: Implement.** `npm run db:generate`, rename to `0023_quick_read.sql`. In `setNeedsLogin(false)` add `checkPauseSeconds: sql\`case when ${suppliers.checkPauseSeconds} = 10 then 3 else ${suppliers.checkPauseSeconds} end\``. `latestByMapping` selects `read_by as "readBy"`.
- [ ] **Step 4: Run, expect PASS** — same command plus `packages/db/test/schema.int.test.ts`.
- [ ] **Step 5: Commit** — `git commit -am "feat: record how a page was read, allow 15 and 30 minute checks, start no-login suppliers at a 3 s pause"`.

---

### Task 5: Scheduling: intervals and staleness

**Files:**
- Modify: `packages/scheduling/src/schedule.ts` (`INTERVALS = [15, 30, 60, 180, 360, 720, 1440]`, `isStale` threshold `max(2 × interval, 120 min)`)
- Test: `packages/scheduling/src/schedule.test.ts`, `apps/api/test/schedule.int.test.ts`

- [ ] **Step 1: Failing tests.** `isStale(at, 15, at + 61 min)` is false and `at + 121 min` true; `isStale(at, 1440, at + 2881 min)` true (unchanged). `runExpirySeconds(1, 3) >= 3 * 20 + 20 + 3` (three tries fit; already true: assert it so a later change cannot break it). API: `PUT /api/suppliers/:id/schedule` with `intervalMinutes: 15` and `30` → 200; `20` → 400.
- [ ] **Step 2: Run, expect FAIL** — `npx vitest run packages/scheduling apps/api/test/schedule.int.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat: automatic checks every 15 or 30 minutes"`.

---

### Task 6: Worker: quick first, three tries, how it was read

**Files:**
- Modify: `apps/worker/src/extraction-check.ts` (`visit`, `finish`, `notVisited`, log line), `apps/worker/src/supplier-visit.ts` (`quickEligible`)
- Test: `apps/worker/test/extraction-check.int.test.ts`

**Interfaces:**
- Consumes: `browser.quickRead` (Task 3), `ObservationInput.readBy` (Task 4).
- Produces: `quickEligible(supplier: Pick<SupplierRecord, "needsLogin" | "stealth">, recipe: Recipe): boolean` — `!needsLogin && !stealth && !!recipe.builtIn && recipe.pageChecks.length === 0 && !recipe.region`.
- `Visit` gains `readBy: "quick" | "browser" | null`.

- [ ] **Step 1: Failing tests** (fake service `quickRead: "ok"` with `quickOffers`):
  - no-login supplier, built-in default, quick offers `OutOfStock` → answer out of stock, one `/quick-read`, no `/capture`, observation `readBy: "quick"`, link `lastLinkCheckAt` set and `workedTitle` unchanged.
  - quick `ok` but offers `[]` → falls back: one `/quick-read`, one `/capture`, `readBy: "browser"`, answer from the capture.
  - quick result `login_required` / `captcha` / blocked → falls back to `/capture`.
  - two offers that differ, link without option → falls back.
  - quick `missing` (404) → falls back, check succeeds.
  - recipe with page checks, or region on, or supplier stealth on, or supplier needs a login → never calls `/quick-read`.
  - capture `unreachable` twice then `ok` → real answer; sleeps recorded `[5000, 15000]` (plus the run's own pause); `readBy: "browser"`.
  - capture `unreachable` three times → cannot tell `check_failed`, exactly 3 `/capture` calls; three such links in a row still stop the run with `unreachable`.
  - capture `login_required` → exactly 1 `/capture` (no retry); `captcha`, `blocked`, `unknown` also 1.
  - a failed automatic login before the page → observation `readBy: null`.
  - log line `stock check finished` has `readBy`; a fallback logs `quick_read: fallback (no_offers)` with no address.
- [ ] **Step 2: Run, expect FAIL** — `npx vitest run apps/worker/test/extraction-check.int.test.ts`.
- [ ] **Step 3: Implement.** In `visit`: if `quickEligible`, call `quickRead`; build `page` with `sections: []`, `buttons: []`, the offers and `url: finalUrl ?? mapping.url`; use it only when `ok && result === "ok" && decide(...).decidedBy === "built_in"`; the link observation is `{ result, status, finalUrl, title: null, heading: null, softNotFound }`. Otherwise the existing capture path inside a loop of at most 3 tries, sleeping 5000 then 15000 between tries only when the try ended `unreachable` or `service_unavailable`. Fallback reasons: `not_ok`, `blocked`, `no_offers`, `variant_unclear`, `built_in_unclear`, `unavailable`.
- [ ] **Step 4: Run, expect PASS** — same command, then `npx vitest run apps/worker/test`.
- [ ] **Step 5: Commit** — `git commit -am "feat: stock checks read quickly when they can, and try an unloadable page three times"`.

---

### Task 7: Web: history wording and schedule choices

Invoke `ui-ux-pro-max` and `design-taste-frontend` first.

**Files:**
- Modify: `apps/web/src/api.ts` (`Observation.readBy`), `apps/web/src/pages/MappingsPage.tsx` (history line), `apps/web/src/components/scheduleWords.ts` (`INTERVAL_CHOICES` gains `{ 15, "Every 15 minutes" }`, `{ 30, "Every 30 minutes" }` after Off)
- Test: `apps/web/src/pages/MappingsPage.test.tsx`, `apps/web/src/components/SchedulePanel.test.tsx`

- [ ] **Step 1: Failing tests.** History item with `readBy: "quick"` contains "Read quickly"; `"browser"` contains "Read with the browser"; `null` shows neither. The schedule select lists "Every 15 minutes" and "Every 30 minutes" and saving 15 sends `intervalMinutes: 15`.
- [ ] **Step 2: Run, expect FAIL** — `npx vitest run apps/web/src/pages/MappingsPage.test.tsx apps/web/src/components/SchedulePanel.test.tsx`.
- [ ] **Step 3: Implement** (` · Read quickly` / ` · Read with the browser` after the version text).
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat: show how each answer was read, and the 15 and 30 minute choices"`.

---

### Task 8: Docs, end to end, full check

**Files:**
- Modify: `docs/pilot-flow.md`, `README.md`, `docs/deployment.md` (log lines `quick-read:`, `quick_read: fallback`, `stock check: retry`), `e2e/scheduling.spec.ts` (choose "Every 15 minutes")

- [ ] **Step 1:** e2e: the Schedule card saves "Every 15 minutes" and the schedule list shows it. Run `npm run build && npx playwright test --project scheduling-desktop --no-deps`.
- [ ] **Step 2:** Docs: quick reads (what, when it falls back, that nothing is set up), three tries, the 3 s starting pause and why the pause matters, the two new schedule choices. No supplier names.
- [ ] **Step 3:** `npm run check` → green; report counts. Run `npx playwright test --project extraction-desktop --no-deps` too.
- [ ] **Step 4: Commit** — `git commit -am "docs: quick reads, three tries and 15/30 minute checks"`.
