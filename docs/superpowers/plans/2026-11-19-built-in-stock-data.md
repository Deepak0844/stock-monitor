# Built-in Stock Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Answer stock from the page's built-in schema.org `availability` data, fall back to the owner's word rules, and check suppliers that need no login without any session.

**Architecture:** The capture reads a bounded list of offers from JSON-LD and microdata. A pure `pickOffer` in `@stock-monitor/extraction` picks the link's offer, and `decide` uses it before the word rules when the rules version has `builtIn` on. A per-supplier `needs_login` flag lets the gate and workers skip every session step. A per-link `supplier_option` handles pages with several options.

**Tech Stack:** TypeScript, npm workspaces, Vitest, Drizzle + PostgreSQL, Fastify, Playwright, React + Tailwind.

**Spec:** `docs/superpowers/specs/2026-11-19-built-in-stock-data-design.md` (read it first; this plan argues from it).

## Global Constraints

- Public repo: no supplier names or domains in code, tests, fixtures, docs or commit messages. Use `supplier.example`.
- Commits: conventional types (feat, fix, test, docs, chore). NO `Co-Authored-By` or "Generated with" lines.
- Rules are data only and go through `validateRecipe`. Saved versions are never changed.
- Unclear is `cannot_tell`, never `out_of_stock`.
- Existing suppliers (`needs_login` default `true`) and existing rule versions (no `builtIn` key) behave exactly as before.
- The capture never keeps raw HTML or script text, only the offer fields: `availability`, `url`, `sku`, `name`, each cut to 200 characters, at most 100 offers.
- Migration number `0022`. Generate with `npm run db:generate`, then rename to `0022_built_in_stock.sql` if drizzle picks another name.
- UI tasks: invoke `ui-ux-pro-max` and `design-taste-frontend` first (CLAUDE.md), and use the existing `Panel`, `Field`, `Input`, `Select`, `Notice`, `Button` components and the existing wording style.
- Verification for every task: `npm run typecheck && npm run lint` plus the task's tests. The final task runs `npm run check`.

## Review Focus

1. **A page with JSON-LD that is broken, huge or not a product** (a blog post's `Article`, a `BreadcrumbList`): must give no offers, never a crash or a wrong answer. Tested in Task 3.
2. **Built-in value written in other forms** (`http://schema.org/InStock`, `https://schema.org/InStock`, `InStock`, `schema:InStock`, lower case): all must map the same way. Tested in Task 1.
3. **A no-login supplier whose page still shows a login wall:** the visit must come back `login_required` and stop the run, never be read as stock. Tested in Task 5.
4. **An old saved page (no `offers`, no `link`) tested with built-in on:** must fall back to the word rules, or `page_changed` without word rules, never throw. Tested in Task 2.
5. **Turning built-in on with only in-stock examples labelled:** the version must refuse to turn on, with a message that says to label an out-of-stock page. Tested in Task 6.

---

### Task 1: Built-in availability and offer picking (pure)

**Files:**
- Create: `packages/extraction/src/built-in.ts`
- Create: `packages/extraction/src/built-in.test.ts`
- Modify: `packages/extraction/src/index.ts` (add `export * from "./built-in.js";`)

**Interfaces:**
- Produces:
  - `type Offer = { availability: string; url: string | null; sku: string | null; name: string | null }`
  - `type LinkRef = { url: string | null; option: string | null }`
  - `type Waiting = "in_stock" | "out_of_stock" | "cannot_tell"`
  - `availabilityName(raw: string): string` — the last path part after `/` or `:`, e.g. `"InStock"`.
  - `availabilityAnswer(raw: string, waiting: Waiting): Answer | null` — `null` means not clear.
  - `pickOffer(offers: Offer[], link: LinkRef, waiting: Waiting): { answer: Answer; offer: Offer } | { unclear: "variant_unclear" | "built_in_unclear" } | null` — `null` means no offers.

- [ ] **Step 1: Write the failing tests**

```ts
describe("availabilityAnswer", () => {
  it.each(["InStock", "LimitedAvailability", "OnlineOnly"])("%s is in stock", (v) => expect(availabilityAnswer(v, "out_of_stock")).toBe("in_stock"));
  it.each(["OutOfStock", "SoldOut", "Discontinued"])("%s is out of stock", (v) => expect(availabilityAnswer(v, "in_stock")).toBe("out_of_stock"));
  it.each(["PreOrder", "PreSale", "BackOrder", "MadeToOrder"])("%s follows the waiting choice", (v) => {
    expect(availabilityAnswer(v, "out_of_stock")).toBe("out_of_stock");
    expect(availabilityAnswer(v, "in_stock")).toBe("in_stock");
    expect(availabilityAnswer(v, "cannot_tell")).toBeNull();
  });
  it.each(["InStoreOnly", "Reserved", "Whatever", ""])("%s is not clear", (v) => expect(availabilityAnswer(v, "out_of_stock")).toBeNull());
  it.each(["https://schema.org/InStock", "http://schema.org/InStock", "schema:InStock", "instock", " InStock "])("%s reads as InStock", (v) => expect(availabilityAnswer(v, "out_of_stock")).toBe("in_stock"));
});

const offer = (availability: string, extra: Partial<Offer> = {}): Offer => ({ availability, url: null, sku: null, name: null, ...extra });
const noLink: LinkRef = { url: null, option: null };
describe("pickOffer", () => {
  it("no offers is no data", () => expect(pickOffer([], noLink, "out_of_stock")).toBeNull());
  it("one offer answers", () => expect(pickOffer([offer("InStock")], noLink, "out_of_stock")).toMatchObject({ answer: "in_stock" }));
  it("offers that agree answer", () => expect(pickOffer([offer("OutOfStock"), offer("SoldOut")], noLink, "in_stock")).toMatchObject({ answer: "out_of_stock" }));
  it("one unclear offer is built_in_unclear", () => expect(pickOffer([offer("Reserved")], noLink, "out_of_stock")).toEqual({ unclear: "built_in_unclear" }));
  const two = [offer("InStock", { url: "https://supplier.example/products/w?variant=1", sku: "A-1", name: "500 ml" }), offer("OutOfStock", { url: "/products/w/?variant=2", sku: "A-2", name: "1 L" })];
  it("matches the link's variant value, path and slash ignored", () =>
    expect(pickOffer(two, { url: "https://other.example/products/w?variant=2&x=1", option: null }, "in_stock")).toMatchObject({ answer: "out_of_stock" }));
  it("matches the link's option by sku", () => expect(pickOffer(two, { url: "https://supplier.example/products/w", option: "a-1" }, "out_of_stock")).toMatchObject({ answer: "in_stock" }));
  it("matches the link's option by name", () => expect(pickOffer(two, { url: null, option: "1 l" }, "in_stock")).toMatchObject({ answer: "out_of_stock" }));
  it("no match is variant_unclear", () => expect(pickOffer(two, { url: "https://supplier.example/products/w", option: "2 L" }, "in_stock")).toEqual({ unclear: "variant_unclear" }));
  it("two offers matching one option is variant_unclear", () =>
    expect(pickOffer([offer("InStock", { name: "Red" }), offer("OutOfStock", { name: "Red" })], { url: null, option: "Red" }, "in_stock")).toEqual({ unclear: "variant_unclear" }));
  it("no link is variant_unclear", () => expect(pickOffer(two, noLink, "in_stock")).toEqual({ unclear: "variant_unclear" }));
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run packages/extraction/src/built-in.test.ts` → "Failed to resolve import ./built-in.js".

- [ ] **Step 3: Implement `built-in.ts`.** `availabilityName` trims, takes the text after the last `/` or `:`, and lower-cases it for the lookup. The mapping table is a `Record<string, "in" | "out" | "waiting">` keyed by lower-case name; anything else is not clear. `pickOffer` order (spec §2): no offers → `null`; map each offer; all mapped answers equal and non-null → that; else link `variant` match (compare `URL.pathname` with trailing `/` removed, and `searchParams.get("variant")`, offer URLs resolved against `link.url`, unparsable URLs skipped); else exactly one offer with `normaliseWords(sku) === normaliseWords(option)` or `normaliseWords(name) === normaliseWords(option)`; else `variant_unclear`. A single matched offer whose value is not clear → `built_in_unclear`.

- [ ] **Step 4: Run, expect PASS** — same command.

- [ ] **Step 5: Commit** — `git add packages/extraction/src/built-in*.ts packages/extraction/src/index.ts && git commit -m "feat: read schema.org availability and pick the link's offer"`

---

### Task 2: Rules version gains built-in data; `decide` and the example test use it

**Files:**
- Modify: `packages/extraction/src/types.ts`, `validate.ts`, `decide.ts`, `testing.ts`
- Test: `packages/extraction/src/validate.test.ts`, `decide.test.ts`, `testing.test.ts`

**Interfaces:**
- Consumes: `Offer`, `LinkRef`, `Waiting`, `pickOffer` (Task 1).
- Produces:
  - `PageDescription` gains `offers?: Offer[]` and `link?: { url: string; option: string | null }`.
  - `Recipe` gains `builtIn?: { waiting: Waiting }`.
  - `Reason` gains `"variant_unclear" | "built_in_unclear"`.
  - `Decision` gains `decidedBy: "built_in" | "rules" | null` (`null` for every `cannot_tell` and region answers).
  - `decide(page: PageDescription, recipe: Recipe, region: string | null, link: LinkRef): Decision`
  - `Example` gains `link: LinkRef`. `runExamples(examples, recipe)` passes it to `decide`.
  - `hasBothAnswers(results: ExampleResult[]): boolean` — at least one `expected: "in_stock"` and one `expected: "out_of_stock"`.
  - `allPass(results: ExampleResult[], recipe: Recipe): boolean` — as today, and when `recipe.builtIn` is set also `hasBothAnswers`.

- [ ] **Step 1: Write the failing tests**

`validate.test.ts`:
```ts
it("accepts built-in data with no page checks", () => {
  expect(validateRecipe({ pageChecks: [], inStock: [], outOfStock: [], builtIn: { waiting: "out_of_stock" } })).toEqual({ ok: true, recipe: { pageChecks: [], inStock: [], outOfStock: [], builtIn: { waiting: "out_of_stock" } } });
});
it("still needs a page check without built-in data", () => expect(validateRecipe({ pageChecks: [], inStock: [], outOfStock: [] }).ok).toBe(false));
it.each([{ waiting: "maybe" }, { waiting: "in_stock", extra: 1 }, "on", null])("refuses built-in %j", (builtIn) => expect(validateRecipe({ pageChecks: [], inStock: [], outOfStock: [], builtIn }).ok).toBe(false));
```

`decide.test.ts` (use the existing fixture helpers in `fixtures.ts`; `page(...)` below means one of them with `offers` added):
```ts
const link = { url: "https://supplier.example/p/w", option: null };
const builtIn = { pageChecks: [], inStock: [], outOfStock: [], builtIn: { waiting: "out_of_stock" as const } };
it("built-in answers first", () => expect(decide(page({ offers: [offer("OutOfStock")] }), { ...builtIn, inStock: [{ type: "text", text: "Add to basket" }] }, null, link)).toMatchObject({ answer: "out_of_stock", decidedBy: "built_in", matchedText: "Built-in data: OutOfStock" }));
it("word rules answer when built-in data is missing", () => expect(decide(page({ lines: ["In stock now"] }), { ...builtIn, inStock: [{ type: "text", text: "In stock now" }] }, null, link)).toMatchObject({ answer: "in_stock", decidedBy: "rules" }));
it("no data and no word rules is page_changed", () => expect(decide(page({}), builtIn, null, link)).toMatchObject({ answer: "cannot_tell", reason: "page_changed" }));
it("unclear data and no word rules keeps its reason", () => expect(decide(page({ offers: [offer("Reserved")] }), builtIn, null, link)).toMatchObject({ answer: "cannot_tell", reason: "built_in_unclear" }));
it("failing page checks win over built-in data", () => expect(decide(page({ offers: [offer("InStock")] }), { ...builtIn, pageChecks: [{ type: "text", text: "Not on page" }] }, null, link)).toMatchObject({ reason: "page_changed" }));
it("the region rule wins over built-in data", () => { /* region table page with "Hull\t0" and offers [InStock], recipe with region + builtIn, region "Hull" → out_of_stock */ });
it("built-in off ignores offers", () => expect(decide(page({ offers: [offer("InStock")], lines: ["Sold out"] }), { pageChecks: [], inStock: [], outOfStock: [{ type: "text", text: "Sold out" }] } as Recipe, null, link)).toMatchObject({ answer: "out_of_stock", decidedBy: "rules" }));
it("an old saved page with no offers falls back", () => expect(() => decide(page({}), builtIn, null, { url: null, option: null })).not.toThrow());
```
(The "built-in off" case uses an otherwise-valid recipe with one page check; adjust to the fixture.)

`testing.test.ts`:
```ts
it("built-in versions need an in-stock and an out-of-stock example", () => {
  const r = (expected: Answer) => ({ id: expected, name: expected, expected, got: { answer: expected } as Decision, passed: true });
  expect(allPass([r("in_stock")], builtInRecipe)).toBe(false);
  expect(allPass([r("in_stock"), r("out_of_stock")], builtInRecipe)).toBe(true);
  expect(allPass([r("in_stock")], wordRecipe)).toBe(true);
});
it("passes each example's link to decide", () => { /* two-offer page, link.url ?variant=2 → expected out_of_stock passes */ });
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run packages/extraction`.

- [ ] **Step 3: Implement.** `validate.ts`: allow `builtIn` in `only(...)`; `waiting` must be one of the three values and nothing else in the object; the "add at least one page check" message only when `builtIn` is absent. `decide.ts`: the order in spec §2 (page checks → region → built-in → words → `page_changed` when built-in is on, there are no `inStock`/`outOfStock` rules and no `quantity`, and there were no offers; unclear built-in data with no word rules → its own reason). Every existing return sets `decidedBy` (`"rules"` for word/quantity answers, `null` otherwise). `testing.ts`: pass `e.link`; add `hasBothAnswers`; change `allPass`. Fix every caller of `decide` and `allPass` (`apps/worker/src/extraction-check.ts` gets a temporary `{ url: mapping.url, option: null }`, `apps/api/src/routes/recipes.ts` passes `recipe`); Tasks 5 and 6 finish them.

- [ ] **Step 4: Run, expect PASS** — `npx vitest run packages/extraction && npm run typecheck`.

- [ ] **Step 5: Commit** — `git commit -am "feat: built-in data answers stock before the word rules"`

---

### Task 3: The capture reads the offers

**Files:**
- Modify: `services/browser/src/capture.ts` (`describePage`, `PageSections`/`CaptureOutcome` types, `capturePageIn` return)
- Modify: `packages/browser-client/src/client.ts:38-41,199-213` (type and parse `description.offers`)
- Test: `services/browser/test/read-page.browser.test.ts`, `packages/browser-client/src/client.test.ts` (or the existing client test file)

**Interfaces:**
- Produces: `CaptureOutcome.description.offers: Offer[]` and `PageDescriptionParts.offers: Offer[]` (same shape as Task 1's `Offer`; re-declare in the browser service, which does not import `@stock-monitor/extraction`).

- [ ] **Step 1: Write the failing tests** in `read-page.browser.test.ts`, one `page.setContent(...)` per case, asserting `(await readPage(page)).offers`:
  - JSON-LD `Product` with `offers: [{ availability: "https://schema.org/InStock", url: "/p/w?variant=1", sku: "A-1", name: "500 ml" }]` → `[{ availability: "InStock", url: "<page origin>/p/w?variant=1", sku: "A-1", name: "500 ml" }]` (relative URL resolved).
  - `ProductGroup` with `hasVariant: [{ "@type": "Product", name: "Red", url: "/p/w?variant=7", offers: { availability: "OutOfStock" } }]` → `name: "Red"`, url from the variant.
  - `@graph` holding the `Product` → its offer.
  - Microdata `<link itemprop="availability" href="https://schema.org/SoldOut">` → `[{ availability: "SoldOut", url: null, sku: null, name: null }]`.
  - Broken JSON in one script and a valid one in another → only the valid one's offers.
  - `Article` / `BreadcrumbList` only → `[]`.
  - 500 offers → length 100. A 5,000-character `sku` → 200 characters.
  - A JSON-LD script with `"secretKey": "x"` beside the offer → the result's JSON does not contain `"secretKey"`.

  Client test: a `/capture` reply with `description.offers` keeps them; a reply with no `offers` gives `offers: []`; a reply with a non-array `offers` is `{ ok: false, reason: "failed" }`.

- [ ] **Step 2: Run, expect FAIL** — browser tests run in the Playwright container: `docker run --rm -e CI=1 -v "$PWD":/src -w /src mcr.microsoft.com/playwright:v1.65.0-noble sh -c "npm ci && npx playwright install chromium && xvfb-run npx vitest run services/browser/test/read-page.browser.test.ts"` (copy the repo without `node_modules` first, as in earlier projects). Client test: `npx vitest run packages/browser-client`.

- [ ] **Step 3: Implement.** Inside `describePage` (it runs in the page, so no imports; named inner functions are fine because `readPage` runs `NAME_SHIM` first): walk each parsed JSON-LD value depth-first (arrays, `@graph`, `offers`, `hasVariant`), at most 2,000 nodes visited, collecting offers from nodes whose `@type` (string or array) is `Offer`/`AggregateOffer`, or that sit under a `Product`/`ProductGroup`'s `offers`. Resolve URLs with `new URL(u, location.href).href` in a try/catch. Then add microdata `[itemprop=availability]` (`href` or `content`). Map `availability` through the same "last path part" rule. Update the `describePage` doc comment to the spec's wording. The client validates `offers` is an array when present and passes it through.

- [ ] **Step 4: Run, expect PASS** — the same two commands.

- [ ] **Step 5: Commit** — `git commit -am "feat: the capture reads the page's built-in offers"`

---

### Task 4: Database: `needs_login` and `supplier_option`

**Files:**
- Modify: `packages/db/src/schema.ts` (suppliers ~line 138, mappings ~line 311)
- Create: `packages/db/drizzle/0022_built_in_stock.sql` (+ drizzle meta)
- Modify: `packages/db/src/supplier-repository.ts`, `packages/db/src/mapping-repository.ts`
- Test: `packages/db/test/supplier-repository.int.test.ts`, `packages/db/test/mapping-repository.int.test.ts`

**Interfaces:**
- Produces:
  - `SupplierRecord.needsLogin: boolean`; `suppliers.setNeedsLogin(id: string, needsLogin: boolean): Promise<SupplierRecord | null>`.
  - `keepingAlive()` returns only suppliers with `needs_login = true`.
  - `MappingRecord.supplierOption: string | null`; `MappingInput.supplierOption?: string | null`; `update(id, patch)` accepts `supplierOption?: string | null`.

- [ ] **Step 1: Write the failing tests**
```ts
it("a new supplier needs a login", async () => expect((await create()).needsLogin).toBe(true));
it("needs-login can be turned off and on", async () => { const s = await create(); expect((await repo.setNeedsLogin(s.id, false))?.needsLogin).toBe(false); expect((await repo.setNeedsLogin(s.id, true))?.needsLogin).toBe(true); });
it("keep-alive skips a supplier with no login", async () => { /* supplier with keepAliveMinutes 30, setNeedsLogin false → keepingAlive() excludes it */ });
it("a link keeps its supplier option", async () => { const m = await mappings.create({ ...input, supplierOption: "500 ml" }); expect(m.supplierOption).toBe("500 ml"); expect((await mappings.update(m.id, { supplierOption: null }))?.supplierOption).toBeNull(); });
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run packages/db/test/supplier-repository.int.test.ts packages/db/test/mapping-repository.int.test.ts` (needs the test database, as the other `.int.test.ts` files).

- [ ] **Step 3: Implement.** `needsLogin: boolean("needs_login").notNull().default(true)` on suppliers; `supplierOption: text("supplier_option")` on mappings, with a check `supplier_option is null or char_length(supplier_option) <= 200`. `npm run db:generate`, name the file `0022_built_in_stock.sql`. Add the fields to every select in both repositories.

- [ ] **Step 4: Run, expect PASS** — same command, plus `npx vitest run packages/db/test/schema.int.test.ts`.

- [ ] **Step 5: Commit** — `git commit -am "feat: suppliers can need no login, links can name a supplier option"`

---

### Task 5: Gate and worker: checks with no login, link passed to `decide`

**Files:**
- Modify: `packages/mapping/src/gate.ts` (`SupplierGate.needsLogin`, `whyNotChecked`)
- Modify: `apps/worker/src/auto-login.ts:43-44`, `apps/worker/src/extraction-check.ts` (`visit`), `apps/worker/src/extraction-capture.ts:~46-64`, `apps/worker/src/mapping-link-check.ts:~83`, `apps/worker/src/scheduling-tick.ts` (`precheckLogin`)
- Test: `packages/mapping/src/gate.test.ts`, `apps/worker/test/extraction-check.int.test.ts`, `extraction-capture.int.test.ts`, `mapping-link-check.int.test.ts`, `scheduling-tick.int.test.ts`

**Interfaces:**
- Consumes: `SupplierRecord.needsLogin`, `MappingRecord.supplierOption` (Task 4); `decide(..., link)` (Task 2); `description.offers` (Task 3).
- Produces: `EMPTY_STATE: SessionState = { cookies: [], origins: [] }` exported from `apps/worker/src/extraction-check.ts`, reused by the other two workers. Saved pages' `description` holds `offers` and `link: { url: mapping.url, option: mapping.supplierOption }`.

- [ ] **Step 1: Write the failing tests**
  - `gate.test.ts`: `whyNotChecked({ ...granted, sessionStatus: "not_connected", needsLogin: false }, false)` → `null`; with `automationPermission: "unknown"` → `no_permission`; with `enabled: false, pausedReason: "owner"` → `paused`; with `needsLogin: true` and no session → `not_connected` (unchanged).
  - `extraction-check.int.test.ts`, supplier with `needsLogin: false`, no saved session, a fake browser recording requests:
    - `checkStock` calls `browser.capture` with `state: { cookies: [], origins: [] }`, no `loginUrl`, no `loggedInMarker`; never calls `browser.login`; `supplierSessions` unchanged after an ok visit.
    - A fake capture with `offers: [{ availability: "OutOfStock", ... }]` and a `builtIn` recipe → observation `answer: "out_of_stock"`, `matchedText: "Built-in data: OutOfStock"`.
    - A fake capture with `result: "login_required"` → the run stops with `login_required` (Review Focus 3).
    - A two-offer page and a link with `supplierOption: "1 L"` → the "1 L" offer's answer.
  - `extraction-capture.int.test.ts`: no-login supplier is captured with no session; the saved description has `offers` and `link: { url, option }`.
  - `mapping-link-check.int.test.ts`: no-login supplier's link check runs with the empty state.
  - `scheduling-tick.int.test.ts`: a no-login supplier with a due run starts it, and never queues `supplier.session.verify` (early or keep-alive).

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run packages/mapping apps/worker/test`.

- [ ] **Step 3: Implement.** `whyNotChecked`: skip the `not_connected` line when `supplier.needsLogin === false`. `ensureLoggedIn`: return `"skipped"` first when `!supplier.needsLogin`. In each of the three workers, when `!supplier.needsLogin` skip `getSealed`/`unsealSessionState` and `saveRefreshedSession`, send `EMPTY_STATE` and leave out `loginUrl`/`loggedInMarker`. `visit` builds `page.offers = outcome.description.offers` and calls `decide(page, recipe, region, { url: mapping.url, option: mapping.supplierOption })`. `precheckLogin` returns `false` when `!supplier.needsLogin` (add `needsLogin` to its parameter type).

- [ ] **Step 4: Run, expect PASS** — same command.

- [ ] **Step 5: Commit** — `git commit -am "feat: check suppliers that need no login without a session"`

---

### Task 6: API: needs-login, link option, examples with links, turn-on gate

**Files:**
- Modify: `apps/api/src/routes/suppliers.ts` (PATCH `/api/suppliers/:id`), `apps/api/src/routes/mappings.ts` (create/update, like `regionOf`), `apps/api/src/routes/recipes.ts` (`examplesFor`, test, activate)
- Test: `apps/api/test/suppliers.int.test.ts`, `mappings.int.test.ts`, `recipes.int.test.ts`

**Interfaces:**
- Consumes: Tasks 2 and 4.
- Produces (HTTP):
  - `PATCH /api/suppliers/:id` accepts `{ needsLogin: boolean }`; supplier JSON has `needsLogin`.
  - Mapping create/update accept `supplierOption` (string ≤ 200, or `""`/`null` to clear; error code `invalid_supplier_option`, message "A supplier option can be up to 200 characters of text, or empty to clear it."); mapping JSON has `supplierOption`.
  - `POST /api/suppliers/:id/recipes/test` results carry `got.decidedBy`.
  - `POST /api/recipes/:id/activate` with `builtIn` and no labelled out-of-stock or in-stock page → `409 examples_need_both`, message "Label at least one in-stock and one out-of-stock saved page before turning on rules that use built-in data."

- [ ] **Step 1: Write the failing tests** for each line above, plus: `needsLogin: "no"` → 400; turning `needsLogin` off keeps the saved session and credentials (read them back); `examplesFor` uses the link's current `url` and `supplierOption`, and for a saved page whose link was deleted, `description.link`; an old saved page with no `link` gives `link: { url: null, option: null }`.

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run apps/api/test/suppliers.int.test.ts apps/api/test/mappings.int.test.ts apps/api/test/recipes.int.test.ts`.

- [ ] **Step 3: Implement.** Handle `needsLogin` in the PATCH before the generic update (like `AUTO_LOGIN_BODY`), calling `setNeedsLogin`. Copy `regionOf` as `supplierOptionOf`. In `examplesFor`, load the mapping once per row and build `link`. In activate, check `hasBothAnswers` before `allPass` when `recipe.rules.builtIn`.

- [ ] **Step 4: Run, expect PASS** — same command.

- [ ] **Step 5: Commit** — `git commit -am "feat: API for needs-login, link options and built-in turn-on rules"`

---

### Task 7: Web: needs-login switch and link option

Invoke `ui-ux-pro-max` and `design-taste-frontend` first.

**Files:**
- Modify: `apps/web/src/api.ts` (`Supplier.needsLogin`, `Mapping.supplierOption`, `suppliers.setNeedsLogin`)
- Create: `apps/web/src/components/NeedsLoginCard.tsx` + `.test.tsx`
- Modify: `apps/web/src/pages/SupplierFormPage.tsx:~94-97` (card first; hide `AutoLoginCard`, keep-alive and connect parts when off), `apps/web/src/pages/SuppliersPage.tsx:~230` (status), `apps/web/src/pages/MappingFormPage.tsx` (field after region, `invalid_supplier_option` → field)
- Test: `SupplierFormPage.test.tsx`, `SuppliersPage.test.tsx`, `MappingFormPage.test.tsx`

**Interfaces:**
- Consumes: Task 6 HTTP.
- Produces: `NeedsLoginCard({ api, supplier, onChange }: { api: Api; supplier: Supplier; onChange: () => void })`.

- [ ] **Step 1: Write the failing tests**
  - The card shows a switch labelled "Needs a login" with the hint "Off when the supplier's product pages show stock without logging in."; toggling calls `api.suppliers.setNeedsLogin(id, false)` and `onChange`.
  - Supplier page with `needsLogin: false`: no "Automatic login" card, and no Connect button. The text "Checked without logging in" is shown.
  - Suppliers list: a `needsLogin: false`, `sessionStatus: "not_connected"` supplier shows "No login needed", not "Not connected".
  - Link form: field "Option on the supplier's page (optional)" with the hint "Only needed when the supplier's page lists several sizes or colours with different stock. Copy the option name or the supplier's SKU from the saved page."; its value is sent as `supplierOption`; the server error `invalid_supplier_option` focuses it.

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run apps/web/src/components/NeedsLoginCard.test.tsx apps/web/src/pages/SupplierFormPage.test.tsx apps/web/src/pages/SuppliersPage.test.tsx apps/web/src/pages/MappingFormPage.test.tsx`.

- [ ] **Step 3: Implement** with existing components and patterns (`AutoLoginCard` is the model for the card).

- [ ] **Step 4: Run, expect PASS** — same command.

- [ ] **Step 5: Commit** — `git commit -am "feat: needs-login switch and link option in the web app"`

---

### Task 8: Web: built-in data on the Stock rules page

Invoke `ui-ux-pro-max` and `design-taste-frontend` first.

**Files:**
- Modify: `apps/web/src/api.ts` (`Recipe.builtIn`, `StockReason` + 2, `Decision.decidedBy`, capture `description.offers`)
- Modify: `apps/web/src/components/RuleEditor.tsx` (`Draft.builtIn: { on: boolean; waiting: Waiting }`, `toDraft`, `toRecipe`, `emptyDraft` with `on: true`, new first fieldset, group headings)
- Modify: `apps/web/src/components/stockWords.ts` (two reasons)
- Modify: `apps/web/src/components/SavedPages.tsx` (built-in line + options list)
- Modify: `apps/web/src/pages/StockRulesPage.tsx` (result line "decided by built-in data" / "decided by your rules"; `turnOnBlock` needs both labels when built-in is on)
- Test: `RuleEditor` tests (create `apps/web/src/components/RuleEditor.test.tsx` if none), `SavedPages` tests, `StockRulesPage.test.tsx`

**Interfaces:**
- Consumes: Task 6 HTTP; `ExampleResult.got.decidedBy`.

- [ ] **Step 1: Write the failing tests**
  - `toRecipe(emptyDraft())` contains `builtIn: { waiting: "out_of_stock" }`; `toDraft` of a version without `builtIn` gives `builtIn.on === false` (existing versions open as saved).
  - The editor shows the switch "Use the stock data built into the supplier's pages" and the select "Pre-order and back-order count as" with options Out of stock / In stock / Cannot tell; with the switch on, the groups read "If the built-in data is missing or unclear" and the page-check hint says page checks are optional.
  - `reasonWords("variant_unclear")` = "The page lists several options with different stock. Set this link's option on the Links page."; `reasonWords("built_in_unclear")` = "The built-in stock data gives a value the app does not count as in or out of stock."
  - Saved page with `offers: [InStock]` shows "Built-in data: In stock"; with no `offers` shows "No built-in data" and "Capture this page again to read its built-in data."; with two differing offers lists each as "500 ml · A-1 · In stock".
  - Test result line ends with "Decided by built-in data." or "Decided by your rules.".
  - Built-in on and only in-stock pages labelled → turn-on hint "Label at least one in-stock and one out-of-stock saved page."

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run apps/web/src/components apps/web/src/pages/StockRulesPage.test.tsx`.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run, expect PASS** — same command.

- [ ] **Step 5: Commit** — `git commit -am "feat: built-in stock data on the Stock rules page"`

---

### Task 9: End-to-end, docs, full check

**Files:**
- Modify: `e2e/extraction.spec.ts` (+ a fixture page in `e2e/fixtures/` with JSON-LD), `docs/pilot-flow.md`, `README.md`

- [ ] **Step 1: Write the e2e journey:** a supplier with "Needs a login" off (no connect step), a link to the JSON-LD fixture page served by the e2e stack, capture two pages (in stock, out of stock), label them, switch built-in on, test (all pass, "Decided by built-in data."), save, turn on, check the link → "Out of stock" on the Links page.

- [ ] **Step 2: Run, expect FAIL then PASS** — `npm run test:e2e -- e2e/extraction.spec.ts`.

- [ ] **Step 3: Docs.** Add "Suppliers without a login" and "Built-in stock data" sections: how to check a supplier with View Source (search `availability`), that old saved pages need a fresh capture, and the both-labels rule. No supplier names.

- [ ] **Step 4: Full check** — `npm run check` → all green. Report the unit and integration counts.

- [ ] **Step 5: Commit** — `git commit -am "test: built-in stock data journey; docs: suppliers without a login"`
