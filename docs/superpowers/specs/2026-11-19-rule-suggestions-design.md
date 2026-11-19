# Stock rule suggestions: design

Status: approach agreed with the owner 2026-11-19 (option A). Awaiting approval of this design before a plan is written.

## Why

Today the owner must invent the words for "Page checks", "In stock when" and "Out of stock when" by reading a supplier page. The rules themselves are already layout-independent (words and button labels, never CSS), so the problem is not matching but knowing what to type. The owner wants this to be friendly and to work with any supplier layout.

## What changes

A "Suggest rules" button on the Stock rules page. It looks at the saved pages the owner has already labelled in stock or out of stock, and proposes rules with the reason for each. The owner ticks the ones they want. Ticked suggestions fill the existing rule editor. The existing test run and the "label at least one page" gate stay as they are.

## Goals

- A new supplier needs only: capture and label one page of each answer, press Suggest, tick, test, save.
- Every suggestion shows evidence, for example "on 3 of 3 out-of-stock pages, 0 of 4 in-stock pages".
- Suggestions never reach a rule that was not ticked, and never change a saved version.

## Non-goals

- No AI model and no page text leaves the server.
- No learning of login fields. That is the next project.
- No new tables. Suggestions are computed on request and not stored.
- No change to how rules are evaluated or to the Recipe format.

## Anti-goals

- A suggestion that makes the test fail, or that matches an unrelated "Sold out" badge in a related-products section, counts as a failure even if it looks plausible.

## Approaches considered

- **A. Compare labelled examples with plain code.** Chosen. Free, instant, explainable, private.
- **B. Ask an AI model.** Better with odd wording and one example, but costs money, sends supplier page text outside, and is not repeatable. Could be an optional extra later.
- **C. Built-in phrase list only.** Fails on unusual wording. Kept only as a ranking boost inside A.

## Design

1. **Engine** in `packages/extraction` (pure function, no I/O): `suggestRules(examples)`. It takes the labelled examples already used by `runExamples` (page description plus expected answer) and returns candidates, each with `kind` (pageCheck, inStock, outOfStock), a `StockRule`, evidence counts, and a score.
   - Candidate sources: each section line (as a text rule) and each button (as a button rule, with its enabled state), taken under the product's own heading when the pages share one.
   - A candidate for "out of stock" is scored by how many out-of-stock examples contain it against how many in-stock examples contain it. In-stock is the mirror. Anything seen on both sides scores zero and is dropped.
   - Lines that look like prices, dates, or long product descriptions are skipped, and shorter lines win ties.
   - A built-in list of common phrases (Sold out, Out of stock, Currently unavailable, Notify me, Add to cart and similar) adds a ranking boost. It never creates a suggestion on its own.
   - Page checks come from lines or buttons present on every labelled example, excluding the product title and anything scoped under a related-products-style heading.
   - Every suggestion set is run through the existing test (`runExamples`). The result reports whether the ticked-by-default set passes all examples, and drops a suggestion that alone breaks one.
   - Needs at least one in-stock and one out-of-stock example, otherwise it returns a plain reason ("Label one page in stock and one out of stock").
2. **API**: `POST /api/suppliers/:id/recipes/suggest`, read-only, owner session required, same shape of checks as `/recipes/test`. Returns suggestions and the pass result. Writes an audit entry with counts only, never page text.
3. **Web**: a "Suggest rules" button and a review list in `StockRulesPage`, each row a checkbox with the rule in words and its evidence. "Add ticked rules" appends them to the draft, skipping duplicates. The owner can still edit everything by hand.
4. **Tests**: engine unit tests with the existing `page` and `btn` fixtures, including the related-products badge case, both-sides lines, one-sided data, and prices. An API integration test, and a web component test.

## Constraints

- Follows existing rules: owner-only routes, page content private, rules stay data.
- npm workspaces, no new dependencies.

## Left to the builder

Exact scoring weights, the phrase list wording, and how many suggestions to show by default (proposal: at most 5 per kind).
