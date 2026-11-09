# Spec: extraction

Module id: `extraction`. Depends on: `foundation` (done), `supplier-session` (done), `mapping` (done: links, link status, permission gate, pause between pages). Map: `CAPABILITY-MAP.md`. Intent: `docs/intent/stock-monitor.md`.

Status: **draft v2, owner review answers received (2026-11-10).** Not yet approved. No plan and no code until it is.

## Objective

For each linked supplier page, work out **whether the item appears in stock, appears out of stock (including not listed for the chosen region), or cannot be told**, using rules the owner sets in the app. The app stores what it saw as an **observation** and never decides anything about Shopify (that is `proposals`).

User: the store owner, not technical. Success: the owner can set up a supplier's rules from a saved picture of a real page, test them on saved examples, run a check, and read the answer in plain words. When the supplier changes its layout, the owner is told that the rules need a look, and the app never reports "out of stock" for a page it no longer understands.

## Decisions recorded (owner, 2026-11-10)

| Question | Answer |
|---|---|
| What is the main part? | The stock check. The owner controls it in the app: "if this appears, the item is in stock; if that appears, it is out of stock". |
| How are rules built? | **Option A:** fixed rule types picked from a list (text on the page, button on the page, number next to a label, product page looks right). Read-only: no clicking, typing or scrolling. The recipe keeps the step-list shape so click steps can be added later for a supplier that needs one. |
| Region | Some suppliers list stock per region on the same product page (a table of names with numbers). The owner chooses the region in the app. The app finds the label and reads the number next to it. |
| Layout changes | Suppliers can change their layout at any time. The rules must say "cannot tell" and tell the owner, never "out of stock". |
| Region label not on the page | **Out of stock.** Shown as "Out of stock: not listed for <region>", so the owner can see why. It counts only when the rest of the region table is still on the page (see "The answers"). |
| Each supplier differs | Yes. Every supplier has its own recipe, and nothing is assumed about how a supplier shows stock. The real rules are written from a real capture. |
| Region setting | A supplier default region, overridable on each link. |
| One visit for link status and stock | Yes. |
| Turning on needs passing examples | Yes. |
| Quantity and text disagree | **Cannot tell, and flagged** (my recommendation, adopted: contradictory data should not drive a Shopify change). |
| When checks run | Only when the owner asks, until `scheduling` exists. |

## What exists today that this builds on

- `mappings` (variant, supplier, page address), with a link status and a gate that refuses checks unless the supplier is connected, running and **recorded as allowed**. A run waits the supplier's pause between pages and is one page at a time.
- The browser service loads a page with a saved session through the network guard and reports the status, final address, title and first heading. It does **not** read the page body or take pictures yet.
- Notifications (one open per kind and supplier), the job queue with long-run options, the audit log.

## Assumptions (correct me now)

1. **Rules are data, never code.** The owner types words and picks from lists. No regular expressions, scripts or selectors are typed in. Words are matched ignoring capitals and extra spaces.
2. **One recipe per supplier**, applied to all that supplier's links, with a version number. A recipe never changes in place: saving makes a new version, and each observation records which version produced it.
3. **Matching is by wording, not by position.** The app stores what it was pointed at as visible words, so a supplier moving a block around does not break a rule. If wording is renamed or removed, the answer is "cannot tell".
4. **Capture is taken by the app, on request.** The owner presses Capture on one link. The app loads the page with the saved login and stores a picture and a plain description of the page (see "What a capture holds"). Captures stay in the database and are shown only to the owner.
5. **Region is a label on the page.** A link has an optional region (the label to look for), with a supplier default. A region that is not on the page, while the rest of the region table is, means out of stock (shown "Not listed for <region>"). If the whole table is gone, it is cannot tell.
6. **One visit does two jobs.** A stock check loads the page once and also updates the link status (works, page missing, moved...), so the supplier is visited once, not twice. The mapping rules for page missing and the unavailable candidate are reused unchanged.
7. **Checks run when the owner asks** (one link, or all of a supplier's links). Regular checks come with `scheduling`.
8. Notifications stay in the dashboard only (earlier decision).

## How the app reads a page (it does not read the picture)

The app does **not** read the picture. The picture is only for you, so you can see what the page looked like when you set the rules. The rules run on the page's **text and structure**: the browser already knows the words it is showing (headings, rows, button labels), and the app takes those words directly. That is exact, fast and does not depend on how the page looks.

- It does not use image reading (OCR) or AI: both are out of scope (intent).
- If a supplier ever draws its stock as a picture instead of text, the app cannot read it, and the answer is **Cannot tell**, never a guess.

## The answers

Every observation has one of three answers, in words, plus a reason when needed:

| Answer | Meaning |
|---|---|
| **In stock** | The in-stock rules matched, the out-of-stock rules did not, and the page passed its page check. |
| **Out of stock** | The out-of-stock rules matched, the in-stock rules did not, and the page passed its page check. Or the region row is there and its number is 0. Or the chosen region's label is **not on the page** while the rest of the region table is (reason shown: "Not listed for <region>"). |
| **Cannot tell** | Anything else. The reason is shown: the page changed (page check failed), both rules matched, neither matched, quantity and text disagree, or the check itself did not work (login needed, puzzle, blocked, supplier unreachable, page missing). |

**Cannot tell never counts as out of stock, anywhere.** A login redirect, puzzle, block, timeout or changed page can never become "out of stock" (intent rule).

**A missing page (404, or a redirect to the home page).** The answer is **Cannot tell**, with the reason "page missing" or "address never worked". It is not decided here, because a 404 can mean two different things: a **wrong address** (a typo, never loaded the right page) or a **product the supplier has removed**. The `mapping` rules tell them apart, and the stock check updates the same link status from the same visit:

| What the link did before | What the visit finds | Link status | What follows |
|---|---|---|---|
| **Worked before** | 404, or redirected to the home page | **Page missing** (shown "Worked until <date>") | After **two such checks at least 6 hours apart**, and not a supplier-wide run, the link is an **unavailable candidate**. `proposals` may then suggest "unavailable" for you to approve. Nothing changes in Shopify without your approval. |
| **Never worked** | 404, or redirected to the home page | **Never worked** | Treated as a wrong address for you to fix. Never a candidate, never "out of stock". |

One case cannot be told apart by any rule: a link whose first-ever check already finds the page removed. It shows as **Never worked** and waits for you to look.

## Rule types (version one)

Each rule is one question about the page. The owner picks the type, fills in the words, and may limit it to the part of the page under a heading.

| Type | The question | Example |
|---|---|---|
| **Text on the page** | Is this wording on the page? | "Sold out" |
| **Button on the page** | Is a button or link with this label on the page, and is it enabled? | "Add to cart" |
| **Number next to a label** | What number comes right after this label, in the same row or line? | "Loughborough" then 46 |
| **Page check** | Is this a normal product page? (wording that must be there) | the heading contains the product name, or the text "Add to cart" or "Sold out" is somewhere |

Every rule has an optional **only under this heading** setting: it looks only at the part of the page under that heading, up to the next heading of the same or higher level. This stops wording elsewhere (a "Sold out" badge on a related product) from deciding this item.

A stock recipe has:
- one or more **page checks** (all must pass),
- **in-stock rules** (any one matching counts),
- **out-of-stock rules** (any one matching counts),
- an optional **quantity rule** (a number next to a label), and
- an optional **region rule** (a number next to the chosen region's label, under a heading such as "Click and collect availability").

Reading the answer: page checks first. If one fails, **cannot tell: the page changed**. Then, if the link has a region: the app first looks for the **region table** (the heading the rule is limited to, and at least one other row with a label and a number). If the table is not there, it is **cannot tell: the page changed**. If the table is there and the region's label is not, it is **Out of stock: not listed for <region>**. If the label is there, a number above 0 is **In stock** with that quantity and 0 is **Out of stock**. Without a region: if only in-stock rules match, **In stock**; only out-of-stock rules, **Out of stock**; both or neither, **cannot tell**. A quantity found but disagreeing with the text (quantity 0 with an in-stock match, or above 0 with an out-of-stock match) is **cannot tell: quantity and text disagree**, and it is flagged.

## What a capture holds

Captured by the browser service, with the saved session, through the guard. Never cookies, never form values, never scripts, never hidden fields, never anything typed into a password field.

- A **picture** (PNG, size capped).
- A **page description**: the address (no query string), title, the visible text split into **sections by heading** (each with its lines, rows kept together so a label and its number stay on one line), and a list of **buttons and links** with their labels and whether each is enabled.
- The **HTTP status** and the page class the session check already uses (normal, login, puzzle, blocked...).

The owner can give each saved capture a **name and an expected answer** (for example "Blue Tee, in stock, expected In stock"). These are the test examples. A recipe version can only be turned on when it gives the expected answer on **every** labelled capture of that supplier, and at least one capture exists. Captures are limited (50 per supplier, oldest unlabelled removed first) and the owner can delete any of them.

When a check gives **cannot tell: the page changed**, the app keeps that page's capture (last three per link) so the owner can open it, see what changed beside the rules, fix the rules and test again.

## Behaviour

1. **Stock rules screen (per supplier).** Shows the saved captures, and the recipe: page checks, in-stock rules, out-of-stock rules, quantity rule, region rule. The picture and the page's text sit beside the rules, and the parts a rule matches are highlighted. Each rule can be tested on any saved capture. A **Test all examples** button runs the recipe on every labelled capture and shows which passed.
2. **Capture.** **Capture a page** on a supplier, choosing one of its links. Refused with a plain reason when the supplier is not connected, paused or has no recorded permission (same gate as link checks).
3. **Saving a version.** Saving makes a new version. **Turn on** is available only when all labelled captures pass. The previous version is kept. A supplier with no active version is not checked.
4. **Region.** The supplier has a default region label, and each link can override it (left blank, it uses the supplier's). A supplier with no region rule ignores regions.
5. **Check stock.** **Check stock** on one link, or **Check all stock** for a supplier. Refused with a plain reason when the supplier is not allowed, not connected, paused, or has no active recipe. One page at a time, with the supplier's pause between pages. Each check stores an observation.
6. **Reading it.** The Links page shows, for each link, the latest answer in words, the quantity if there is one, the matched wording (short), and when it was seen. The history of observations for a link can be opened.
7. **Layout-change protection.** If **cannot tell: the page changed** happens on a link, the Links page says "The page changed. Review the stock rules." If it happens on at least 5 links and at least 30% of a supplier's links in one run, it is a **supplier-wide change**: one notification on the Dashboard ("<supplier>'s pages changed. Review its stock rules.") with a link to the rules screen, and nothing else. A later successful run resolves it.
8. **Never:** click, type, scroll or choose anything on a supplier's site; keep or show a session, cookie or password; store page content in a log, audit event or job; call a failed, blocked or changed page "out of stock"; change anything in Shopify; propose anything.

## Data model

| Table | Purpose |
|---|---|
| `stock_recipes` | One row per supplier version: `supplier_id`, `version`, `rules` (the rule list, validated), `active` (at most one active per supplier), `created_at`, `activated_at`. Never edited after saving. |
| `page_captures` | One per capture: `supplier_id`, `mapping_id` (nullable), `name`, `expected_answer` (nullable), `status`, `page_class`, `description` (jsonb: address, title, sections, buttons), `picture` (bytea), `kept_reason` (`example` or `page_changed`), `created_at`. |
| `stock_observations` | One per check: `mapping_id`, `observed_at`, `answer`, `reason`, `quantity` (nullable), `matched_text` (short, nullable), `quantity_mismatch` (bool), `recipe_version`, `check_result` (what the visit found), `capture_id` (nullable). Append only. |
| `suppliers` (existing) | Gains `default_region` (nullable text). |
| `mappings` (existing) | Gains `region` (nullable text). |
| `notifications` (existing) | Gains kind `recipe_needs_review`, one open per supplier. |

## Security

- **Captures are private page content** (they can show account names, wholesale prices, stock). They are stored in the database, shown only to the signed-in owner, never written to a log, audit event, job or error message, and deletable. Description text is rendered as plain text and never as HTML, because it is untrusted.
- **Rules are validated data:** limited counts and lengths, no patterns or code, so a rule cannot run anything or hang the checker.
- **Captures and checks go through the browser service and its network guard.** An address that points at a private network is never visited. The browser service gets one new call; it still has no database access and no encryption key.
- Job payloads carry only an id. Audit events record who changed a recipe and how many captures or checks, never page content.
- All routes need the signed-in owner.

## Interface (all need a signed-in owner)

`POST /api/suppliers/:id/captures` (body `{mappingId}`), `GET /api/suppliers/:id/captures`, `GET /api/captures/:id`, `GET /api/captures/:id/picture`, `PATCH /api/captures/:id` (name, expected answer), `DELETE /api/captures/:id`, `GET/POST /api/suppliers/:id/recipes`, `POST /api/suppliers/:id/recipes/test` (run a draft on the saved captures, saves nothing), `POST /api/recipes/:id/activate`, `PATCH /api/suppliers/:id/region`, `POST /api/mappings/:id/check-stock`, `POST /api/suppliers/:id/check-stock`, `GET /api/mappings/:id/observations`. Browser service: `POST /capture`. Jobs: `extraction.capture` `{captureId}`, `extraction.check` `{mappingId}`, `extraction.checks` `{supplierId}`, ids only.

## Screens

- **Stock rules** (per supplier, from the supplier's row and the sidebar): captures, picture and text, rule editor, **Test all examples**, version list, **Turn on**.
- **Links** gains the latest stock answer and the **Check stock** buttons, and the history of observations.
- **Supplier edit** gains the default region. The link form gains an optional region.
- **Dashboard** shows the "pages changed" notification and a card with how many links are in stock, out of stock and cannot tell.

## Project structure

```
packages/extraction/      pure logic: page description reader, rule validation, rule evaluation, answer decision, supplier-wide change
packages/db/              new tables and columns, repositories
packages/browser-client/  capture call (and its fake)
services/browser/src/     capture.ts: picture and page description
apps/api/src/routes/      captures, recipes, stock checks, region
apps/worker/src/          extraction-capture.ts, extraction-check.ts
apps/web/src/pages/       StockRulesPage, additions to Links, supplier form, dashboard
e2e/                      fake supplier pages for each case below
```

## Commands

`npm run check`, `npm run test:e2e`, `npm run test:browser`, `npm run db:generate`. No new commands.

## Code style

Same as the rest of the repo: small pure functions that return a result for expected problems, plain-English messages, strict types.

```ts
export type Decision = { answer: "in_stock" | "out_of_stock" | "not_listed" | "cannot_tell"; reason: string | null; quantity: number | null; matchedText: string | null };
/** Pure: the same description and recipe always give the same decision. The editor's Test button and the real check both call it. */
export function decide(page: PageDescription, recipe: Recipe, region: string | null): Decision { /* ... */ }
```

## Testing strategy

Test-first throughout. Automated tests never visit a real supplier, and the fixtures are made-up pages.

**Unit (pure):** the rule evaluator and `decide` on made-up page descriptions: in stock; out of stock; "Sold out" only on a related product (scoped rule ignores it); region listed with a number; region listed with 0; region label missing while the table is there (Out of stock, not listed); region table gone (cannot tell, not out of stock); label renamed (cannot tell); page check failing; both rule sets matching; neither matching; quantity 0 with an in-stock button; extra spaces and different capitals; a label and its number on the same row and on the next line; a heading that appears twice; rule validation (limits, no patterns); supplier-wide change (5 links and 30%).

**Browser (real Chromium, fake supplier):** capture reads the picture, headings, sections, rows and button states; never cookies, form values, scripts or hidden fields; a password field's contents are never read; large pages are capped; a private address is never visited; fake pages for in stock, sold out, region table, layout changed, related-product "Sold out" badge, login, puzzle, blocked, 404.

**Integration (real PostgreSQL):** a recipe is never edited, only versioned; one active version per supplier; activation refused unless all labelled captures pass; observations are append only; deleting a supplier removes its recipes, captures and observations; capture limits.

**API:** every route needs the owner; plain refusals (not allowed, not connected, paused, no active recipe); jobs carry only ids; nothing private in audit or logs.

**Worker:** a check stores an observation and updates the link status from the same visit; a supplier that needs a login or is blocked gives "cannot tell: check did not work" and no change to the supplier's own status; the pause between pages; supplier-wide change makes one notification and no per-link ones; a long run gets time to finish and is never retried.

**Browser journeys:** capture a page, label examples, build rules, test all examples, turn on, check stock, see each answer, change the fake page's layout and see "cannot tell" with the notification, with accessibility scans in light and dark at desktop and phone size.

## Boundaries

- **Always:** match by wording, treat anything unclear as "cannot tell", test on labelled captures before a recipe turns on, version recipes, keep captures private, use the fake supplier in tests, honour the pause between pages.
- **Ask first:** adding a dependency, adding a click or typing step type, reading anything from a supplier site beyond the capture description, changing how supplier sessions work.
- **Never:** click, type or scroll on a supplier's site; run owner-typed code or patterns; store cookies, form values or passwords; show captured content as HTML; call a failed, blocked or changed page "out of stock"; write to Shopify; propose changes.

## Success criteria

1. The owner can capture a page of a connected, allowed supplier and see its picture and text, and delete it.
2. The owner can build a recipe from the four rule types, with "only under this heading", and test it on every labelled capture before turning it on. Turning on is refused if any example fails.
3. A check of a made-up in-stock page, sold-out page, region table (listed, zero, label missing) and layout-changed page gives In stock, Out of stock, In stock or Out of stock with the right quantity, Out of stock (not listed for the region), and Cannot tell: the page changed. A region label missing while the whole region table is also gone gives Cannot tell, not Out of stock.
4. A "Sold out" badge on a related product does not change the answer when the rule is scoped to the right heading.
5. Quantity and text disagreeing gives Cannot tell and is flagged.
6. A login redirect, puzzle, block, timeout or changed page is never Out of stock, in any test.
7. At least 5 links and 30% cannot-tell in one run raises one Dashboard notification, and a later good run resolves it.
8. One visit updates both the stock answer and the link status, and the pause between pages is honoured.
9. Capture content never appears in a log, audit event, job or error; cookies, form values and password contents are never captured.
10. Recipes and observations are append only; a supplier delete removes them; the history of a link's observations can be read.
11. `npm run check`, the browser tests and the browser journeys pass, including the accessibility scan of the new screens.

## Resolved questions (owner, 2026-11-10)

1. Each supplier shows stock differently, so each has its own recipe. The pilot's real rules come from a real capture.
2. A supplier default region, overridable on each link.
3. One visit updates the stock answer and the link status. A 404 or a redirect to the home page is "page missing" on a link that worked before (a candidate after two checks 6 hours apart, for your approval) and "never worked" on a link that never did (a wrong address to fix).
4. A recipe turns on only when it passes every labelled example.
5. Quantity and text disagreeing is Cannot tell and flagged.
6. Checks only on request.

## Still open for the owner

1. **Approve this version?** If anything above is not what you want, say what to change.
2. **First capture.** After the module is built, the first real job is capturing one of the pilot supplier's product pages and writing its rules together. Nothing in the spec depends on what that page shows.
