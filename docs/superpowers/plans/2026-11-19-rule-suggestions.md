# Stock Rule Suggestions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Suggest rules" button proposes page checks, in-stock rules and out-of-stock rules from the owner's labelled saved pages, with evidence for each.

**Architecture:** A pure function `suggestRules` in `packages/extraction` builds candidates from the labelled pages and counts them with the real matchers (`textMatches`, `buttonMatches`), so a suggestion means what it will mean in a real check. A read-only API route returns the result. The Stock rules page shows a tick list that appends ticked rules to the existing draft. No new tables, no new storage, no change to `Recipe` or `decide`.

**Tech Stack:** TypeScript, Vitest, Fastify, React, npm workspaces.

**Spec:** `docs/superpowers/specs/2026-11-19-rule-suggestions-design.md`

## Global Constraints

- No AI model. No page text leaves the server. No new dependency.
- Suggestions are computed on request and never stored. Saved versions never change.
- At most 5 suggestions per kind. Needs at least one in-stock and one out-of-stock labelled page.
- Skip price-like lines, date-like lines, number-only lines and lines over 80 characters.
- The route is owner-only like `/recipes/test`. Its audit entry holds counts only, never page text.
- Use npm, not pnpm. Branch from `develop` as `feature/rule-suggestions`. Do not touch the owner's `.env`.

## Review Focus

- Pages labelled only on one side: plain "Label one page in stock and one out of stock" answer, no crash.
- A "Sold out" badge under "You may also like": must not be suggested as an out-of-stock rule.
- A line on both sides (for example "Free delivery"): never suggested as an in-stock or out-of-stock rule.
- Different out-of-stock wording on different pages ("Sold out" on one, "Currently unavailable" on the other): both suggested, both ticked, and the set passes.
- Labelled `cannot_tell` pages: ignored for suggestions, but counted in the pass result.

---

### Task 1: Suggestion engine

**Files:**
- Modify: `packages/extraction/src/evaluate.ts` (export `scopeLines`, add `main`-scope helper only if needed)
- Create: `packages/extraction/src/suggest.ts`
- Create: `packages/extraction/src/suggest.test.ts`
- Modify: `packages/extraction/src/index.ts` (add `export * from "./suggest.js";`)

**Interfaces:**
- Consumes: `Example`, `runExamples`, `allPass` from `testing.ts`; `textMatches`, `buttonMatches` from `evaluate.ts`; `normaliseWords` from `validate.ts`; types `StockRule`, `Recipe`, `PageDescription` from `types.ts`; fixtures `page`, `btn` from `fixtures.ts` in tests.
- Produces:
  ```ts
  export type SuggestionKind = "pageCheck" | "inStock" | "outOfStock";
  export type Suggestion = {
    kind: SuggestionKind;
    rule: StockRule;
    /** Labelled pages of the matching answer that contain it, and how many there are. For a page check: all in/out pages. */
    seenOn: number;
    ofTotal: number;
    /** Pages of the opposite answer that contain it, and how many there are. Always 0 for a suggested stock rule. */
    seenOnOther: number;
    otherTotal: number;
    /** Matches a built-in common phrase. */
    starter: boolean;
    /** Ticked by default: the smallest set that covers every page of that answer. Page checks: up to 3. */
    checked: boolean;
  };
  export type SuggestResult =
    | { ok: false; reason: "need_both_answers" }
    | { ok: true; suggestions: Suggestion[]; /** the ticked set passes every example */ passes: boolean };
  export function suggestRules(examples: Example[]): SuggestResult;
  export const STARTER_PHRASES: { inStock: string[]; outOfStock: string[] };
  ```

- [ ] **Step 1: Write failing tests in `suggest.test.ts`.** Use `page`/`btn` fixtures. Named tests, each asserting on `suggestRules(examples)`:
  - `needs one page of each answer`: only in-stock examples gives `{ ok: false, reason: "need_both_answers" }`; `cannot_tell` pages do not count.
  - `suggests the disabled button and Sold out text for out of stock`: in page has `btn("Add to cart", true, "Blue Tee")`; out page has `btn("Add to cart", false, "Blue Tee")` and line "Sold out". Expect an `outOfStock` suggestion with rule `{ type: "text", text: "Sold out" }`, `seenOn: 1, ofTotal: 1, seenOnOther: 0, otherTotal: 1, starter: true, checked: true`; one `outOfStock` `{ type: "button", label: "Add to cart", enabled: false }`; one `inStock` `{ type: "button", label: "Add to cart", enabled: true }`; `passes: true`.
  - `ignores a Sold out badge under another heading`: related-products section holds "Sold out" on the in-stock page; no `outOfStock` suggestion for "Sold out" comes from that page's evidence (it must not count as seen on the other side, and must not be suggested for in stock).
  - `never suggests a line seen on both sides as a stock rule`: "Free delivery" on both pages appears only as a `pageCheck` candidate or not at all, never as `inStock`/`outOfStock`.
  - `suggests both wordings when out-of-stock pages differ`: two out pages with "Sold out" and "Currently unavailable"; both suggested and `checked`, `passes: true`.
  - `skips prices, dates, numbers and long lines`: lines "£12.99", "Back 12/03/2026", "42", and an 81-character line never appear.
  - `page checks are shared by every in and out page, not the product title`: "SKU" line on all pages is a `pageCheck`; the level-1 heading text is not.
  - `caps each kind at 5`: 8 distinct one-sided lines on the out page give 5 `outOfStock` suggestions, ranked starter phrases first then shorter lines.
  - `a cannot_tell example is ignored for suggestions but counted in passes`: add a cannot_tell page that the ticked rules answer differently; `passes` is false.

- [ ] **Step 2: Run `npx vitest run packages/extraction/src/suggest.test.ts`.** Expected: FAIL, `suggestRules` not defined.

- [ ] **Step 3: Implement `suggestRules`.** Algorithm:
  1. Split examples into `inPages` and `outPages` (by `expected`); return `need_both_answers` if either is empty.
  2. Candidate text rules: each line of `scopeLines(page, undefined, true)` (the product's own section, exactly what `decide` reads for stock rules), including its heading line except the first level-1 heading. Candidate button rules: each button of that scope with its own `enabled` state. Apply the line filters from Global Constraints. Dedupe by `type + normaliseWords(text|label) + enabled`.
  3. Count every candidate with the real matchers (`textMatches` / `buttonMatches`, `main = true`) on each in/out page. Keep `outOfStock` candidates with `seenOn > 0` on out pages and 0 on in pages; mirror for `inStock`. A candidate is built only from its own side's pages.
  4. Rank by `seenOn / ofTotal`, plus 0.5 when `starter` (normalised text contains a phrase from `STARTER_PHRASES` for that kind), minus `length / 200`; ties by shorter text. Keep the top 5 per kind.
  5. `checked`: walk the ranked list greedily, tick a suggestion only if it matches at least one page of that answer not yet covered, until all are covered.
  6. Page checks: candidates (same extraction, but `main = false`, count with the real matchers) present on every in and out page, excluding the first level-1 heading text and any rule already suggested as stock rule. Rank starter-phrase-free, shorter first; keep 5; tick the first 3.
  7. `passes`: build a `Recipe` from the ticked suggestions and return `allPass(runExamples(examples, recipe))`, over all examples including `cannot_tell`.
  Put `STARTER_PHRASES` as a plain exported constant: in-stock `["add to cart", "add to basket", "add to bag", "in stock", "buy now"]`, out-of-stock `["sold out", "out of stock", "currently unavailable", "temporarily unavailable", "notify me", "email me when", "back in stock"]`.

- [ ] **Step 4: Run `npx vitest run packages/extraction`.** Expected: PASS, no existing extraction test changes.

- [ ] **Step 5: Commit.**
  ```bash
  git add packages/extraction/src
  git commit -m "feat: suggest stock rules from labelled saved pages"
  ```

### Task 2: Suggest route

**Files:**
- Modify: `apps/api/src/routes/recipes.ts` (new route next to `/recipes/test`)
- Modify: `apps/api/test/recipes.int.test.ts` (new `describe("suggest")`)

**Interfaces:**
- Consumes: `suggestRules`, `SuggestResult` from `@stock-monitor/extraction` (Task 1); the file's own `examplesFor`, `object`, `SUPPLIER_NOT_FOUND`, `record`.
- Produces: `POST /api/suppliers/:id/recipes/suggest`, body `{}`, response `SuggestResult` JSON (`{ ok, suggestions, passes }` or `{ ok:false, reason }`), 404 `supplier_not_found`, 400 `invalid_input` on unknown body keys, 401 without a session.

- [ ] **Step 1: Write failing integration tests** using the file's `example`, `page`, `call` helpers:
  - `returns suggestions from labelled pages`: an in-stock page with an enabled button and an out-of-stock page with line "Sold out" and a disabled button give 200, `ok: true`, an `outOfStock` suggestion with text "Sold out", `passes: true`.
  - `says why when a side is missing`: only an in-stock example gives 200 `{ ok: false, reason: "need_both_answers" }`.
  - `needs a session`: `call(..., false)` gives 401.
  - `unknown supplier is 404`, `unknown body key is 400`.
  - `audits counts only`: `events("recipe.suggested")` has one row whose `details` has numeric `examples` and `suggestions` and does not contain the string "Sold out".
  - `saves nothing`: recipes list for the supplier is unchanged after the call.

- [ ] **Step 2: Run `npx vitest run apps/api/test/recipes.int.test.ts -t suggest`.** Expected: FAIL, 404 route.

- [ ] **Step 3: Add the route.** Same structure as `/recipes/test`: `object(request.body, [])`, load the supplier, `suggestRules(await examplesFor(...))`, record audit `recipe.suggested` on entity `supplier` with `{ examples, suggestions }` counts, return the result.

- [ ] **Step 4: Run `npx vitest run apps/api/test/recipes.int.test.ts`.** Expected: PASS (needs Docker for the test DB as the other `.int` tests do).

- [ ] **Step 5: Commit.**
  ```bash
  git add apps/api
  git commit -m "feat: suggest rules route"
  ```

### Task 3: Suggestions on the Stock rules page

**Files:**
- Modify: `apps/web/src/api.ts` (types and `recipes.suggest`)
- Modify: `apps/web/src/test/fake-api.ts` (default `suggest` mock)
- Create: `apps/web/src/components/suggestedRules.ts` and `suggestedRules.test.ts`
- Create: `apps/web/src/components/RuleSuggestions.tsx` and `RuleSuggestions.test.tsx`
- Modify: `apps/web/src/pages/StockRulesPage.tsx` (button, panel, add to draft)
- Modify: `apps/web/src/pages/StockRulesPage.test.tsx`

**Interfaces:**
- Consumes: `POST /api/suppliers/:id/recipes/suggest` (Task 2); existing `Draft`, `RuleDraft`, `emptyRule` and the private `fromRule` pattern in `RuleEditor.tsx` (export a `ruleToDraft = fromRule` there rather than copying it).
- Produces in `api.ts`: `SuggestionKind`, `Suggestion`, `SuggestResult` mirroring Task 1 exactly, and `RecipesApi.suggest(supplierId: string): Promise<SuggestResult>`.
- Produces in `suggestedRules.ts`:
  - `addSuggested(draft: Draft, picked: Suggestion[]): Draft` appends each picked rule to its list (`pageChecks`, `inStock`, `outOfStock`), skips a rule already in the list (same type, same words ignoring case and spacing, same enabled), and drops an empty placeholder row from a list it adds to.
  - `evidenceWords(s: Suggestion): string`, plain words, for example `On 3 of 3 out of stock pages and 0 of 4 in stock pages.`; for a page check `On all 7 labelled pages.`
  - `ruleWords(rule: StockRule): string`, for example `Text "Sold out"` and `Button "Add to cart", disabled`.
- Produces: `RuleSuggestions({ result, onAdd, onClose })` component: checkbox list grouped by kind, each row `ruleWords` plus `evidenceWords`, boxes ticked per `checked`, a note "These rules pass all your examples." or "These rules do not pass all your examples. Review before adding." from `passes`, a button "Add ticked rules" and a "Close" button.

- [ ] **Step 1: Write failing tests.**
  - `suggestedRules.test.ts`: `addSuggested` appends to the right lists, skips a duplicate regardless of case, replaces the empty starter row, leaves other lists untouched; `evidenceWords` for out-of-stock and page-check wording; `ruleWords` for text, enabled button, disabled button.
  - `RuleSuggestions.test.tsx`: renders grouped rows with default ticks, unticking a row removes it from what `onAdd` receives, shows the "do not pass" note when `passes` is false, the `need_both_answers` result shows "Label one page in stock and one out of stock." and no add button.
  - `StockRulesPage.test.tsx`: clicking "Suggest rules" calls `api.recipes.suggest` with the supplier id, shows the list, "Add ticked rules" fills the rule editor fields and clears any earlier test result, and a failed call shows the error notice. The button is disabled while another action runs (`busy`).

- [ ] **Step 2: Run `npx vitest run apps/web/src/components apps/web/src/pages/StockRulesPage.test.tsx`.** Expected: FAIL, modules missing.

- [ ] **Step 3: Implement** the files above. In `StockRulesPage.tsx` add `"suggest"` to the `busy` kinds, a "Suggest rules" outline button beside "Test all examples", and a `suggestions` state (`SuggestResult | null`) shown inside the Rules panel above the editor. Adding calls `setDraft(addSuggested(draft, picked))`, `setTest(null)`, closes the list, and shows `toast("Added N rules. Test them before you save.")`. Follow the file's existing `run` helper and `message` error handling. UI work: invoke `ui-ux-pro-max` and `design-taste-frontend` as CLAUDE.md requires, and reuse the existing `Panel`, `Notice`, `Button` components and spacing; no new design tokens.

- [ ] **Step 4: Run `npx vitest run apps/web` and `npm run typecheck` (or the repo's typecheck script) and `npm run lint`.** Expected: PASS, no type errors.

- [ ] **Step 5: Commit.**
  ```bash
  git add apps/web
  git commit -m "feat: suggest rules from saved pages on the stock rules page"
  ```

### Task 4: Verify end to end and record it

**Files:**
- Modify: `docs/status.md` (one line under the current work: rule suggestions built, login picker is next)
- Modify: `e2e/mappings.spec.ts` or the file that already drives the rules page, only if it has a stock rules flow; add one step that labels two captured pages, presses "Suggest rules" and adds ticked rules.

**Interfaces:**
- Consumes: everything above.
- Produces: a clean branch ready for a PR to `develop`.

- [ ] **Step 1: Run the whole suite.** `npm run test:unit`, `npm run test:integration`, `npm run lint`, `npm run typecheck`. Expected: all green. Use the `verification-before-completion` skill: report the real output, not a guess.
- [ ] **Step 2: Try it by hand.** Start the local stack used for earlier projects (isolated Compose project, never the owner's `.env`), capture and label two pages, press "Suggest rules", confirm the ticked set passes and "Save version" works. Say plainly if this could not be run.
- [ ] **Step 3: Update `docs/status.md`, commit, and open a PR to `develop`** with a detailed description, no Claude attribution in the PR text, per the owner's git preferences. Do not merge: the owner says "merge".
  ```bash
  git add docs/status.md
  git commit -m "docs: note rule suggestions"
  ```

## Self-review notes

- Spec coverage: engine and starter phrases and page checks and pass result (Task 1), route and audit with counts only and no storage (Task 2), button and tick list and add to draft (Task 3), tests and docs (Task 4). Non-goals untouched: no AI, no tables, no change to `Recipe` or `decide`.
- Names are the same across tasks: `suggestRules`, `Suggestion`, `SuggestResult`, `STARTER_PHRASES`, `addSuggested`, `evidenceWords`, `ruleWords`, `recipes.suggest`.
- Open call for the builder: exact ranking weights above are a starting point. Change them only if a Task 1 test cannot pass otherwise.
