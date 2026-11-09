# Implementation Plan: extraction

Spec: `SPEC-extraction.md` (approved 2026-11-10). Map: `CAPABILITY-MAP.md`. Steps use `- [ ]` so progress shows.
Repo is public: no supplier names or domains in code, fixtures or docs. Use made-up pages and the fake supplier. Never touch the owner's `.env`. Use npm. One branch from `develop` and one PR per task (pure-logic tasks may share a PR), merge on green. Never `gh pr merge --delete-branch` while a worktree holds the branch.

## Overview
Let the owner capture a real supplier page, write per-supplier stock rules from a small fixed list of rule types, test them on labelled saved captures, turn a version on, and run a stock check on request. A check stores an observation (In stock, Out of stock, or Cannot tell, with a reason) and updates the link status from the same visit. Nothing is clicked, typed or scrolled on a supplier site. Nothing is written to Shopify.

## Architecture decisions
- **Pure logic in a new `packages/extraction`.** `decide(page, recipe, region)` is the single function behind both the editor's Test button and the real check, so they cannot disagree.
- **The browser service describes the page; it never judges it.** New `POST /capture` returns a picture and a `PageDescription` (sections by heading, rows kept together, buttons with enabled flag) plus the same fields `/check-page` returns (status, final address without query string, title, heading, page class). Cookies, form values, hidden fields, scripts and password contents are never read.
- **One visit, two results.** The stock check calls `/capture` once, then runs `decide` (stock answer) and `decideLinkStatus` from the mapping package (link status). `/check-page` stays for the plain link check.
- **Jobs carry only ids** (`extraction.capture`, `extraction.check`, `extraction.checks`), long runs get `expireInSeconds` and `retryLimit: 0` as the mapping run does.
- **Recipes are append only and versioned;** at most one active per supplier, enforced by a partial unique index.
- **Retention without a scheduler:** unlabelled and page-changed captures older than 30 days are deleted whenever a capture or a check is requested (cheap, and no new moving part). shortcut: no timer, so an idle app keeps them until its next capture or check, upgrade with `scheduling`.

## Global constraints (from the spec, verbatim values)
- Answers: `in_stock`, `out_of_stock`, `cannot_tell`. A region label missing counts as out of stock **only** when the region table (the heading the rule is limited to, plus at least one other row with a label and a number) is on the page; otherwise `cannot_tell`.
- Cannot tell never becomes out of stock: login, puzzle, block, timeout, unreachable, changed page, page missing, never worked, both rule sets matching, neither matching, quantity and text disagreeing.
- A missing page (404, redirect to the home page) is `cannot_tell` with reason `page_missing` or `never_worked`; the link status uses the mapping rules unchanged (candidate after 2 checks at least 6 hours apart).
- Supplier-wide change: at least **5** links and at least **30%** of a run are "page changed": one notification, no per-link ones.
- Rules are data: no patterns or code; at most 10 rules per list; text and labels at most 200 characters; headings at most 200 characters; words matched ignoring capitals, extra spaces and non-breaking spaces.
- Captures: at most 50 per supplier (oldest unlabelled removed first); at most 3 "page changed" per link; unlabelled and page-changed captures deleted after **30 days**; labelled examples kept until the owner deletes them. Description text capped (200 KB), picture capped (1 MB).
- A recipe turns on only if it passes every labelled capture of that supplier and at least one exists.
- No page content, picture, cookie or session in any log, audit event, job or error. Audit records who and counts only.

## Review focus (inputs the spec implies; each has a test in the named task)
1. A "Sold out" badge on a related product must not decide this item (scoped rule) (Task 2).
2. Region label missing while the whole region table is also gone must be Cannot tell, not Out of stock (Task 2).
3. Numbers written as `1,204`, `12+`, `Only 3 left`, a number on the line after its label, a label that appears twice (Task 2).
4. A hostile or huge page: 10,000 buttons, a 1 MB line, text with control characters, an input with a typed password (Task 5).
5. A supplier deleted, paused or made not-allowed while its checks are queued (Task 8).
6. A recipe saved while a check is running: the observation records the version that was used (Task 8).

## Dependency graph
```
1 pure: types, validation ── 2 pure: evaluators, decide ── 3 pure: test runner, supplier-wide change
4 db: tables, repos, retention (needs 1 for types)
5 browser: /capture, client, fake pages
3+4+5 ── 6 API + job: captures
2+4 ── 7 API: recipes (versions, test, activate), regions
4+5+2 ── 8 worker + API: stock checks, observations, notification
6,7,8 ── 9 web: Stock rules screen
8 ── 10 web: Links (answers, check buttons, history), regions, dashboard
9,10 ── 11 e2e journeys, accessibility, docs
```

## Tasks

### Task 1: Types and rule validation (pure)
**Files:** create `packages/extraction/{package.json,src/index.ts,src/types.ts,src/validate.ts,src/validate.test.ts}`; register the workspace.
**Interfaces — Produces:**
`PageDescription = { url: string; title: string; status: number | null; pageClass: PageClass; sections: { heading: string | null; level: number; lines: string[] }[]; buttons: { label: string; enabled: boolean; section: string | null }[] }`
`Rule = { type: "text"; text: string; under?: string } | { type: "button"; label: string; enabled?: boolean; under?: string } | { type: "labelled_number"; label: string; under?: string }`
`Recipe = { pageChecks: (TextRule | ButtonRule)[]; inStock: (TextRule | ButtonRule)[]; outOfStock: (TextRule | ButtonRule)[]; quantity?: { label: string; under?: string }; region?: { under: string } }`
`validateRecipe(input: unknown): { ok: true; recipe: Recipe } | { ok: false; message: string }`
`normaliseWords(text: string): string` (lower case, collapse whitespace including non-breaking spaces, trim).
- [ ] Failing tests: valid recipe accepted; unknown rule type, extra fields, more than 10 rules, a 201-character text, an empty text or label, a non-string, an array where an object belongs, and anything containing pattern syntax as a value (kept as plain text, never interpreted) each refused or kept literal with a plain message; at least one page check required; `normaliseWords("Sold  OUT ")` is `"sold out"`.
- [ ] Implement, pass, `npm run check`, commit `feat(extraction): recipe types and validation`.

### Task 2: Rule evaluators and `decide` (pure)
**Files:** `packages/extraction/src/{evaluate.ts,decide.ts,numbers.ts}` and tests.
**Interfaces — Produces:**
`readNumber(text: string): number | null` (first integer in the text; `1,204` is 1204; `12+` is 12; none is null).
`textMatches(page, rule): string | null` (the matched line, within the section under `rule.under` when given, up to the next heading of the same or higher level), `buttonMatches(page, rule): string | null`, `labelledNumber(page, label, under?): { found: false } | { found: true; quantity: number | null; line: string }` (the label starts a line, or equals it; the number is the first in the rest of that line, else the line after it when that line is only a number).
`regionTable(page, under): boolean` (the section exists and has at least one line that is a label followed by a number).
`type Decision = { answer: "in_stock" | "out_of_stock" | "cannot_tell"; reason: Reason | null; quantity: number | null; matchedText: string | null; quantityMismatch: boolean }` with `Reason = "page_changed" | "both_matched" | "neither_matched" | "quantity_text_disagree" | "not_listed" | "check_failed" | "page_missing" | "never_worked"`.
`decide(page: PageDescription, recipe: Recipe, region: string | null): Decision`.
- [ ] Failing tests (made-up descriptions, one assertion each): in stock by a button; out of stock by text; "Sold out" only under a related-products heading is ignored when the rule is scoped and counts when it is not; region listed 46 → in stock with quantity 46; region 0 → out of stock; region label missing with the table present → out of stock, reason `not_listed`; label missing and table gone → cannot tell `page_changed`; label renamed → not listed only if the table is there; page check failing → `page_changed`; both rule sets matching → `both_matched`; neither → `neither_matched`; quantity 0 with an in-stock match → `quantity_text_disagree`, `quantityMismatch` true; number on the next line; label twice (first under the heading wins); capitals and spaces; a disabled button does not match a rule that asks for enabled; `1,204`, `12+`, `Only 3 left` read right; the same inputs always give the same decision.
- [ ] Implement, pass, commit `feat(extraction): evaluate rules and decide the answer`.

### Task 3: Test runner and supplier-wide change (pure)
**Files:** `packages/extraction/src/{testing.ts,wide.ts}` and tests.
**Interfaces — Produces:**
`runExamples(examples: { id: string; name: string; expected: Decision["answer"]; page: PageDescription; region: string | null }[], recipe: Recipe): { id: string; name: string; expected: string; got: Decision; passed: boolean }[]`
`allPass(results): boolean` (false when there are none).
`isSupplierWideChange(reasons: (Reason | null)[]): boolean` (at least 5 and at least 30% are `page_changed`).
- [ ] Failing tests: all pass, one fails, none given → not passing; 4 of 4 is not wide (under 5), 2 of 6 is wide, 1 of 5 is not.
- [ ] Implement, pass, `npm run check`, commit `feat(extraction): test examples and detect a supplier-wide change`. Tasks 1 to 3 share one PR (checkpoint: pure logic complete).

### Task 4: Database
**Files:** modify `packages/db/src/schema.ts` (+ `drizzle/0008_*.sql` via `npm run db:generate`, renamed `0008_extraction.sql`); create `packages/db/src/{recipe-repository,capture-repository,observation-repository}.ts`; extend `supplier-repository.ts`, `mapping-repository.ts`, `notification-repository.ts`; export from `index.ts`.
**Interfaces — Produces:** tables `stock_recipes`, `page_captures`, `stock_observations`; `suppliers.default_region`, `mappings.region` (text, nullable, at most 200 characters); notifications kind adds `recipe_needs_review`, reason adds `page_changed` (widen the check constraints; the dashboard code must still accept old rows).
`recipes.create(supplierId, recipe): {id, version}` (next version, never edits), `recipes.list(supplierId)`, `recipes.activate(id)` (one transaction, only one active per supplier, enforced by a partial unique index), `recipes.active(supplierId)`.
`captures.create({supplierId, mappingId, name})` → pending, `captures.fill(id, {status, pageClass, description, picture})`, `captures.get`, `captures.list(supplierId)`, `captures.label(id, {name, expected})`, `captures.remove`, `captures.keepChanged(mappingId, capture)` (keeps the latest 3), `captures.purge(days = 30)` (unlabelled and page-changed only), enforce 50 per supplier.
`observations.append(row)`, `observations.listFor(mappingId)`, `observations.latestByMapping()`.
- [ ] Failing integration tests (real PostgreSQL): a recipe is never edited, a new save is the next version; two active versions for one supplier is refused; activating switches the active one atomically; deleting a supplier removes recipes, captures, observations; deleting a link removes its observations; the 51st capture removes the oldest unlabelled; labelled ones are never purged; purge removes unlabelled and page-changed older than 30 days and nothing else; observations are append only for the app role (no update or delete grant to change history except the cascade); region columns default null; the old notification rows still load.
- [ ] Implement, `npm run db:generate`, rename the migration, pass, `npm run check`, commit `feat(db): recipes, captures, observations, regions`. Existing truncates of `suppliers` already use `cascade`.

### Task 5: Browser capture
**Files:** create `services/browser/src/capture.ts`, `services/browser/test/capture.browser.test.ts`; modify `server.ts` (+ test), `service.ts`, `packages/browser-client/src/client.ts` (+ test) and `test/fake-browser-service.ts`, `packages/supplier-session/test/fake-supplier.ts`.
**Interfaces — Produces:** `POST /capture {url, loginUrl?, state, picture: boolean}` → `{ result, status, finalUrl, title, heading, softNotFound, blockedRequests, description: {sections, buttons}, picture: string | null }` (picture base64 PNG, at most 1 MB else null). Client `capture(request): Promise<CaptureOutcome>` with `{ ok: false; reason: "failed" | "unavailable" }`.
The description is built in the page by one `evaluate` that walks the visible DOM: skips `display:none`, `visibility:hidden`, `script`, `style`, `noscript`, `template`, and every `input`, `textarea`, `select` and `[type=hidden]`; groups text lines under the nearest preceding `h1` to `h6`; keeps a table row as one line (cells joined with a tab). Caps: 5,000 lines, 2,000 characters a line, 500 buttons, 200 KB in all.
Fake supplier pages: `/stock/in`, `/stock/sold-out`, `/stock/region` (a table of names and numbers under "Click and collect availability"), `/stock/region-no-row`, `/stock/changed` (same product, new wording), `/stock/related-sold-out` (a "Sold out" badge only under "You may also like"), `/stock/form` (a typed password and a hidden field with a marker).
- [ ] Failing tests (real Chromium against the fake supplier): the sections, rows and buttons of each page; a disabled button is `enabled: false`; the password's typed value and the hidden field's marker never appear anywhere in the response; no cookie value in the response; a 10,000-button page and a 1 MB line are capped, not failed; a private address is refused through the guard; the control token is required; the picture is null when not asked for.
- [ ] Implement, pass, `npm run test:browser`, commit `feat(browser): capture a page as text, structure and a picture`.

### Task 6: Capture API and job
**Files:** create `apps/api/src/routes/captures.ts`, `apps/worker/src/extraction-capture.ts` and tests; modify `packages/queue/src/jobs.ts` (`extraction.capture {captureId}`), `apps/api/src/app.ts` and `index.ts`, `apps/worker/src/worker.ts` and `index.ts`.
**Interfaces — Produces:** `POST /api/suppliers/:id/captures {mappingId, name?}` (202, returns the pending capture; refused with the mapping module's plain reasons through `whyNotChecked`), `GET /api/suppliers/:id/captures`, `GET /api/captures/:id` (the description), `GET /api/captures/:id/picture` (`image/png`, `cache-control: private, no-store`), `PATCH /api/captures/:id {name?, expected?}` (`expected` is `in_stock|out_of_stock|cannot_tell|null`), `DELETE /api/captures/:id`. The job reads the saved session and the link's address from the database, calls `capture`, stores the result, purges captures older than 30 days.
- [ ] Failing tests: 401 on every route; each plain refusal; a capture belongs to the supplier in the path; the picture route needs the owner and has the private headers; the job's payload is only `{captureId}`; a deleted supplier or a paused one makes the job skip; the stored row holds no cookie or session (scan the row and the logs); a failed capture is marked failed with a plain reason, never an exception text; the 51st capture removes the oldest unlabelled; purge runs.
- [ ] Implement, pass, commit `feat: capture a supplier page on request`.

### Task 7: Recipes API and regions
**Files:** create `apps/api/src/routes/recipes.ts` and test; modify `suppliers.ts`/`mappings.ts` routes for regions.
**Interfaces — Produces:** `GET/POST /api/suppliers/:id/recipes` (POST validates with `validateRecipe`, saves the next version, returns it), `POST /api/suppliers/:id/recipes/test {recipe, region?}` (runs `runExamples` on the supplier's labelled captures, saves nothing), `POST /api/recipes/:id/activate` (refused with the failing examples unless `allPass`), `PATCH /api/suppliers/:id/region {region}` (null clears), mapping PATCH/POST gain optional `region`. All audited by version number and counts only.
- [ ] Failing tests: invalid recipe gives the plain message; saving twice gives versions 1 and 2; test returns passed and failed examples and saves nothing; activate refused with a list of failures when one fails, refused when there are no labelled captures, allowed when all pass and switches the active version; only one is active; region length limit; every route 401 without the owner.
- [ ] Implement, pass, commit `feat(api): stock recipes, testing, activation and regions`.

### Task 8: Stock checks, observations and the notification
**Files:** create `apps/worker/src/extraction-check.ts` and test, `apps/api/src/routes/stock-checks.ts` and test; modify `jobs.ts` (`extraction.check {mappingId}`, `extraction.checks {supplierId}`), worker and API wiring, `mappings` list route (latest observation).
**Interfaces — Consumes:** `decide`, `decideLinkStatus`, `isSupplierWide`, `whyNotChecked`, `capture` client, the pause and long-run options from the mapping module. **Produces:** `POST /api/mappings/:id/check-stock`, `POST /api/suppliers/:id/check-stock` (202; refused: not allowed, not connected, paused, **no active recipe**, link off), `GET /api/mappings/:id/observations`; mapping rows gain `latestStock: { answer, reason, quantity, matchedText, observedAt } | null`. The job loads the active recipe once per run, visits one page at a time with the supplier's pause, re-checks the supplier before each page, maps a failed visit to `check_failed`, a 404 or home redirect to `page_missing` or `never_worked` (from the link's history), runs `decide` otherwise, appends the observation with the recipe version, saves the link status from the same visit, keeps the capture (picture included) when the reason is `page_changed`, and at the end raises one `recipe_needs_review` notification if the run was supplier-wide (resolves it after a clean run). Observations never contain page text beyond the short matched line.
- [ ] Failing tests (worker, real PostgreSQL, fake browser): every answer in the spec's table; one visit only (one `/capture` request per link); link status updated from the same visit; login, puzzle, block and unreachable give cannot tell and leave the supplier's own status alone; a 404 on a link that worked is `page_missing` and on one that never worked is `never_worked`, neither is out of stock; supplier-wide run gives one notification and no per-link ones, a later clean run resolves it; pause between pages with the injected `sleep`; supplier deleted, paused or made not-allowed mid-run stops it; no active recipe refused in API and worker; observation records the recipe version used; no page text, cookie or picture in logs, audit or the observation; API refusals in plain words; long run gets `expireInSeconds` and `retryLimit: 0`.
- [ ] Implement, pass, commit `feat: check stock on request and store observations`. Checkpoint: nothing touches a real supplier, every safeguard proven.

### Task 9: Web — Stock rules screen
**Files:** `apps/web/src/pages/StockRulesPage.tsx` and test; `components/RuleEditor.tsx`, `components/CapturePanel.tsx`; api client and fake API; route `/suppliers/:id/rules`; link from the supplier row.
Invoke `ui-ux-pro-max` first; match the existing screens (styles, empty states, light and dark).
- [ ] Failing component tests: capture list with state (pending, ready, failed) and **Capture a page** choosing a link, with the server's plain refusal shown; picture and page text side by side, text rendered as plain text only; label and expected answer on a capture; rule editor for each rule type with **only under this heading**; draft recipe tested with **Test all examples** showing passed and failed per example; **Save version**; **Turn on** disabled until all examples pass, with the reason beside it; version list; delete a capture with a confirmation; the note on labelled examples; errors beside fields; a hostile capture (text with `<script>` and HTML) shows as text.
- [ ] Implement, pass, commit `feat(web): stock rules screen`.

### Task 10: Web — Links, regions, dashboard
**Files:** modify `MappingsPage.tsx`, `MappingFormPage.tsx`, `SupplierFormPage.tsx`, `DashboardPage.tsx` and tests, `components/linkStatus.ts`, api client and fake API.
- [ ] Failing tests: the latest answer in words (In stock with quantity, Out of stock with "Not listed for <region>", Cannot tell with the reason in plain words) and when it was seen; **Check stock** per link and **Check all stock** per supplier with the server's refusals shown; a history of observations; "The page changed. Review the stock rules." linking to the rules screen; the default region on the supplier edit page and the optional region on the link form; the dashboard shows the recipe notification with a link to the rules screen (not a Reconnect button) and a card with in stock, out of stock and cannot tell counts; old notifications still show Reconnect.
- [ ] Implement, pass, commit `feat(web): stock answers, check buttons, regions and the dashboard`.

### Task 11: Browser journeys, accessibility, docs
**Files:** `e2e/extraction.spec.ts` in its own Playwright projects (`extraction-desktop`, `extraction-phone`, after the mapping projects, one after another because they reset suppliers and variants); `e2e/stack.ts` and `control.ts` additions; `docs/deployment.md` section "Stock rules".
- [ ] Journeys: capture a page (fake browser stand-in returning a made-up description and picture), label two examples, build rules, **Test all examples**, see one failing example block **Turn on**, fix it, turn on, check stock and see each answer, change what the fake returns to a changed layout and see Cannot tell with the notification and the rules screen link, see a supplier-wide change give one notification; axe scans in light and dark at desktop and phone size on the rules screen, the links page, the supplier form and the dashboard; no sideways scroll.
- [ ] `npm run check`, `npm run test:e2e`, `npm run test:browser` green. Commit `test(e2e): stock rule journeys`. Checkpoint: all 11 spec success criteria, mapped below.

## Spec success criteria → tasks
1 → 5, 6, 9. 2 → 1, 2, 3, 7, 9. 3 → 2, 8. 4 → 2. 5 → 2. 6 → 2, 8. 7 → 3, 8, 10. 8 → 8. 9 → 5, 6, 8. 10 → 4, 8. 11 → 11.

## Risks
| Risk | Mitigation |
|---|---|
| A supplier's bot protection refuses the automated check, so extraction never sees a product page | The answer is Cannot tell, never out of stock; the owner can ask the supplier for a feed. No evasion, ever (spec). |
| A rule matches the wrong part of the page | Scoped rules, page checks, and labelled examples that must pass before a version turns on. |
| The page's stock appears only after a click or scroll | Out of scope for version one (read-only). The answer is Cannot tell. A click step is a later, separate spec. |
| Captures hold private data | Private headers, owner only, 30-day retention, delete buttons, never in logs, text shown as plain text only. |
| A very large or hostile page | Caps on lines, buttons, bytes and picture size, tested. |
| A long run is retried by the queue | `expireInSeconds` sized to the run and `retryLimit: 0`, as for link checks. |

## Open questions
None blocking. Out of scope: click, type or scroll steps, scheduling, proposals and Shopify writes, reading pictures (OCR or AI), several regions at once.
