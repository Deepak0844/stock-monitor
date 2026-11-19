# Built-in stock data and checks without a login

Date: 2026-11-19. Status: draft, waiting for the owner's approval.

## Intent and the why

The stock rules today are words the owner types: "in stock when this text is on the page". Plain "contains" matching breaks in
common cases ("In stock" also matches "Not in stock" and "Email me when back in stock"), every supplier needs hand-written rules,
and every supplier needs a working login.

The owner checked the suppliers by hand. Every supplier but one publishes its stock in the page's built-in product data
(schema.org `availability`, the data shops add for Google). That data is there even when nobody is logged in. Only one supplier
has no built-in data, and it is also the only one whose pages need a login.

So the app should:

1. Read the built-in stock data and use it as the answer when it is there.
2. Check suppliers that do not need a login without any login: no saved session, no automatic login, no keep-alive, no login codes.
3. Keep the owner's word rules as the fallback, and as the only rules for the supplier without built-in data.

Success: a new supplier with built-in data can be checked by adding its links, capturing and labelling a few pages, switching
built-in data on and turning the rules on. No words typed, no login set up.

## Goals

- Read `availability` from JSON-LD (`<script type="application/ld+json">`) and from microdata (`itemprop="availability"`).
- Pick the right offer when a page lists several (size or colour variants).
- Map every schema.org availability value to in stock, out of stock or cannot tell.
- A per-supplier "Needs a login" setting. Off: checks, captures and link checks run with no session.
- Show on the Stock rules page what the built-in data said on each saved page, and which part of the rules decided.

## Non-goals

- Better word rules (exact line, whole words, "does not contain", click a line to make a rule). Separate, later project for the
  one supplier without built-in data.
- Several page layouts per supplier.
- Reading a quantity or price from the built-in data.
- Reading dropdowns, alt text or icons.
- A faster checker without a full browser. Checks still load the page in the browser, only without a session.

## Anti-goals (a failure even if it works)

- A wrong "in stock" from data that never changes. The existing turn-on gate (labelled saved pages must give the expected answer)
  must cover built-in data too, so a supplier whose data is stale is caught before its rules are turned on.
- Any change in behaviour for existing suppliers and existing rule versions until the owner switches something on.
- Reading more of the page than the availability facts. The capture still never keeps raw HTML or scripts.

## Constraints

- The repository is public: no supplier names or domains in code, tests, fixtures or docs.
- Rules stay data only (words and fixed choices), validated by `validateRecipe`. Versions are never changed after saving.
- The safety rule holds: unclear is "cannot tell", never out of stock.
- Old saved pages have no built-in data. Nothing may break on them.

## Approaches

1. **Built-in data inside the existing rules, word rules as fallback (chosen).** A switch in a supplier's rules version. When the
   data is there and clear, it answers. Otherwise the word rules answer. Reuses the editor, versions, saved pages and turn-on gate.
2. **Each supplier picks one source.** A supplier setting: built-in data or word rules, never both. Simpler to explain, but no
   fallback: if a shop drops the data in a redesign, every check is "cannot tell" until the owner notices.
3. **Built-in data and word rules must agree.** Safest, but needs word rules for every supplier, which throws away the main gain.

The owner chose approach 1 after seeing these three.

## Design

### 1. Capture reads the built-in data (`services/browser/src/capture.ts`)

`describePage` gains one bounded reader. It looks only at:

- every `script[type="application/ld+json"]`: `JSON.parse` in a try/catch, then walks the parsed value for nodes whose `@type` is
  (or includes) `Product`, `ProductGroup` or `Offer`/`AggregateOffer`. From `Product.offers`, `ProductGroup.hasVariant[].offers`
  and `@graph` it takes each offer's `availability`, `url` and `sku`.
- every element with `itemprop="availability"`: its `href` or `content` attribute.

It returns `offers: { availability: string; url: string | null; sku: string | null; name: string | null }[]` (`name` is the
offer's own `name`, else the name of the `hasVariant` item it sits in, e.g. "500 ml"), capped at 100 offers, every field cut to
200 characters, `availability` kept as the last path part (`https://schema.org/InStock`, `http://schema.org/InStock` and
`InStock` all become `InStock`). Nothing else from the script is kept. The doc comment on `describePage` changes from "never a
script" to "never a script, except the availability facts of the page's built-in product data".

An offer with no `url` of its own takes the `url` of the `ProductGroup.hasVariant[]` item it sits in. Relative offer URLs are
resolved against the page's address.

`PageDescription` (`packages/extraction/src/types.ts`) and the capture's `description` gain `offers?: Offer[]` and
`link?: { url: string; option: string | null }`. The worker writes `link` (the mapping's address with its query string, and
its option) into the description when it saves a capture, so a saved page keeps it even after its link is deleted (`page_captures.mapping_id` goes null then). Saved pages
already store `description` as JSON, so no column changes. Old saved pages have no `offers`, which means "no built-in data".

### 2. The rules gain a built-in switch (`packages/extraction`)

`Recipe` gains an optional:

```ts
builtIn?: { waiting: "in_stock" | "out_of_stock" | "cannot_tell" };
```

Present means on. `waiting` is how pre-order and back-order count (default `out_of_stock`, the owner's call to make in the editor).
`validateRecipe` allows the key and checks the value. When `builtIn` is on, `pageChecks` may be empty; when it is off, at least
one page check is still required, as today.

Mapping (fixed, in one table in `packages/extraction/src/built-in.ts`):

| Built-in value | Answer |
|---|---|
| `InStock`, `LimitedAvailability`, `OnlineOnly` | in stock |
| `OutOfStock`, `SoldOut`, `Discontinued` | out of stock |
| `PreOrder`, `PreSale`, `BackOrder`, `MadeToOrder` | the owner's `waiting` choice |
| `InStoreOnly`, `Reserved`, anything else | not clear (fall back) |

Choosing the offer for a link (`pickOffer(offers, link)`):

1. No offers: no data.
2. One offer (or all offers give the same answer): that answer.
3. Several that differ, and the link's address has a `variant` query value: the offer whose `url` has the same path (trailing
   slash ignored, host ignored) and the same `variant` value. One found: its answer.
4. Several that differ, and the link has an option set by the owner (see "Option per link" below): the one offer whose `sku`
   or `name` equals it (compared with `normaliseWords`). One found: its answer.
5. Anything else (none found, more than one found, no link address): not clear, reason `variant_unclear`.

The store's own SKUs are never matched: they are not the supplier's. Only the supplier's SKU or option name, as shown on the
page's built-in data and copied by the owner into the link, is matched.

Today the owner's links have no options, so step 2 is the usual path. Steps 3 to 5 are the worst case: a product page that lists
several options with different stock. The answer is never a guess: without a clear match it is "cannot tell", with a reason
that tells the owner to set the link's option.

`decide(page, recipe, region, link)` order:

1. Page checks (all must pass), as today. An empty list passes.
2. Region rule on and a region set: as today. The region table is more specific than built-in data, so it wins.
3. Built-in on and a clear answer: that answer, `matchedText` = `Built-in data: InStock`, new field `decidedBy: "built_in"`.
4. Otherwise the word rules and quantity, as today, `decidedBy: "rules"`.
5. Built-in on, no word rules, and no built-in data at all: `cannot_tell`, reason `page_changed` (the page no longer looks like a
   product page; the existing "kept page" and supplier-wide notice apply). Data there but unclear: `cannot_tell`, reason
   `variant_unclear` or a new `built_in_unclear`.

Failing page checks always win, even over a clear built-in answer: the page is not the product page any more. With built-in
on and data missing, word rules present: the word rules decide (step 4). Login, puzzle and block pages never reach `decide`:
the worker already answers them `check_failed`.

`link.url` is the mapping's own address (with its query string). The capture's `finalUrl` has no query string, so it cannot be
used for variant matching. The editor's Test button (`runExamples` in `packages/extraction/src/testing.ts`, fed by `examplesFor`
in `apps/api/src/routes/recipes.ts`) passes each saved page's link as described below.

`decide` gains a fourth input with the link, `{ url: string | null; option: string | null }`.
`Example` gains the same `link`. For a saved page whose link still exists, the test uses the link's current address and option
(so setting an option and testing again works at once). For a saved page whose link was deleted, it uses the copy stored in the
description at capture time.

`decidedBy` is stored nowhere new: it travels in the decision and the test results only. Observations keep `matchedText`, which
already says "Built-in data: …", and store the new reasons in the existing `reason` text column. Only `page_changed` counts
towards the supplier-wide "pages changed" notice, as today; `variant_unclear` and `built_in_unclear` do not.

Turn-on gate: with built-in on, a version can be turned on only when the labelled saved pages include at least one expected
in stock and one expected out of stock, and all pass. Data that never changes from `InStock` then fails the gate.

### 3. "Needs a login" per supplier

- Migration `0022`: `suppliers.needs_login boolean not null default true`. Every existing supplier keeps today's behaviour.
- `whyNotChecked` (`packages/mapping/src/gate.ts`): when `needsLogin` is false, no session is required and `not_connected` is
  never returned. Permission and paused still apply.
- Worker visits (`extraction-check.ts`, `extraction-capture.ts`, `mapping-link-check.ts`): when `needsLogin` is false, skip
  loading and unsealing the saved session entirely (so no `session_unreadable`), send an empty session state
  (`{ cookies: [], origins: [] }`), no `loginUrl` and no `loggedInMarker`, and never save a refreshed session. The browser
  service API does not change. A visible password box still makes the page `login_required` (`hasPasswordField`).
- `ensureLoggedIn` returns `skipped` at once when `needsLogin` is false.
- The tick skips session checks, early checks and keep-alive for such suppliers. No reconnect notices are raised for them.
- A page that still comes back `login_required`, `captcha` or `blocked` stops the run as today, so a wrong setting is visible.
- Profile mode (`VERIFY_MODE=profile`) keeps working: the per-site profile simply has no login.

### 3b. Option per link (the worst case for variants)

- The same migration `0022` adds `mappings.supplier_option text null` (up to 200 characters), next to the existing per-link
  `region`.
- The mapping create and update routes (`apps/api/src/routes/mappings.ts`) accept `supplierOption` the same way they accept
  `region`: text up to 200 characters, or empty/null to clear it.
- The worker passes `{ url: mapping.url, option: mapping.supplierOption }` to `decide`, and writes both into a saved page's
  description (`link: { url, option }`) at capture time.
- Only used when a page lists several options with different stock and the address has no `variant` value.

### 4. API

- Supplier read and update gain `needsLogin`. Turning it off does not delete a saved session or credentials, so turning it back
  on restores the old setup.
- The recipe routes accept and return `builtIn` through `validateRecipe`. The test route returns `decidedBy` per example and the
  built-in value it read.

### 5. Web UI

Supplier page:

- A "Needs a login" switch at the top of the login area, with the hint "Off when the supplier's product pages show stock without
  logging in." Off: the connect, automatic login, keep-alive and code email cards are hidden, and the status reads
  "Checked without logging in".

Stock rules page:

- A new first panel in the Rules section, "Built-in stock data": a switch "Use the stock data built into the supplier's pages",
  the mapping table above in plain words, and a select "Pre-order and back-order count as" (Out of stock / In stock / Cannot tell).
  On by default in a new supplier's first draft. Existing versions open with it off, as saved.
- With the switch on, the word rule groups are headed "If the built-in data is missing or unclear", and page checks become optional.
- Saved pages: each page shows a small line "Built-in data: In stock" (or "No built-in data" for an old page, with a hint to
  capture it again). A page with several options lists them (name, supplier SKU, stock), so the owner can copy one into the link.

Links page:

- The link edit form gains "Option on the supplier's page (optional)", next to the region field, with the hint "Only needed when
  the supplier's page lists several sizes or colours with different stock. Copy the option name or the supplier's SKU from the
  saved page."
- Test results: each example says "decided by built-in data" or "decided by your rules".
- New reason words: `variant_unclear` "The page lists several options with different stock. Set this link's option on the
  Links page.", `built_in_unclear` "The built-in stock data gives a value the app does not count as in or out of stock."

The UI work follows the project's existing components (`Panel`, `Field`, `Select`, `Notice`) and wording style.

### 6. Docs

`docs/pilot-flow.md` and the README gain a short "Suppliers without a login" and "Built-in stock data" part: how to check a
supplier by View Source, and that a fresh capture is needed before testing.

## Testing

- `built-in.ts`: every mapping row, the URL forms of a value, `pickOffer` with one offer, same-answer offers, a matching
  `variant` value, a matching link option by SKU and by name, two offers matching one option, no match, no link.
- `decide`: order (region wins, built-in before words, fallback to words, missing data with and without word rules), the
  `waiting` choice.
- `validateRecipe`: `builtIn` allowed, bad values refused, empty page checks only with built-in on.
- Capture: a fixture page with JSON-LD `Product` + `offers` array, `ProductGroup.hasVariant`, `@graph`, broken JSON, microdata,
  a 500-offer page (capped), a script with other keys (not kept).
- Gate and worker: a no-login supplier is checked with no session, never logs in, never saves a session; an existing supplier
  behaves exactly as before.
- e2e: switch built-in on, capture, label, test, turn on, check a link.

## What the owner must do after release

1. On each supplier except the one with a login, turn "Needs a login" off.
2. Capture fresh saved pages (old ones have no built-in data) and label one in-stock and one out-of-stock page.
3. Switch built-in data on, test, save and turn the version on.

## Left to the builder

- Exact component layout of the new panel and switch, within the existing design system.
- Where `pickOffer` lives (`built-in.ts` suggested) and test fixture names.
- Whether the capture reader is a separate function in `describePage` or a second `page.evaluate`.

## Calls made by Claude (owner to check)

- Pre-order and back-order default to out of stock.
- The region rule wins over built-in data.
- Built-in data wins over word rules; word rules never override a clear built-in answer.
- Old rule versions stay as they are (built-in off); only new drafts start with it on.
- With built-in on, turning a version on needs at least one labelled in-stock and one labelled out-of-stock saved page.
- Variants are matched by the `variant` value in the link's address first, then by the link's own option (supplier SKU or
  option name). The store's own SKUs are never used.
- "Data there but unclear" never raises the supplier-wide "pages changed" notice.

## Addendum (2026-11-19): no-login suppliers need no stock rules to start

The owner asked that a supplier with **Needs a login** off is checked without any Stock rules setup.

- **Built-in default.** A no-login supplier with no turned-on rules version is checked with a fixed default: built-in data on,
  pre-order and back-order counting as out of stock, no word rules, no page checks. Its answers are recorded as rules version `0`.
  A supplier that needs a login still needs a turned-on version, as before.
- **Held back from Shopify.** An answer recorded under version `0` never makes a Shopify suggestion. It shows on the Links page
  and in the link's history ("built-in data, not confirmed yet").
- **Confirming** is the existing flow: label one in-stock and one out-of-stock saved page, test, save and turn on a version (the
  first draft already has built-in data on, and turning on already needs both labels). From then on answers carry that version
  and reach Shopify as usual.
- The Stock rules page of such a supplier says so in one notice.

Approaches considered: (1) this default plus hold-back, chosen; (2) the default with no hold-back, refused because stale public
data would reach Shopify unchecked; (3) creating a real rules version automatically when the login is turned off, refused
because it would make a version the owner never tested.
