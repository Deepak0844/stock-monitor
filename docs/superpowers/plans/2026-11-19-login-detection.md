# Login Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatic login finds buttons and openers by guessing, and a "Check login page" list lets the owner pick the right control when the guess is wrong.

**Architecture:** Step 1 adds `login-guess.ts` (pure word rules plus in-page guessing of the submit button and the opener) and wires it into `login.ts` behind the existing exact-wording matches. Step 2 adds `login-inspect.ts` (what a login would use, plus every visible candidate, with generated selectors), a `POST /login/inspect` service route, a client method, an API route, and a list in `AutoLoginCard`. Picks are saved as selectors in the existing `login_selectors` column. No migration.

**Tech Stack:** TypeScript, Playwright (real Chromium in browser tests), Node http, Fastify, React, Vitest, npm workspaces.

**Spec:** `docs/superpowers/specs/2026-11-19-login-detection-design.md`

## Global Constraints

- Nothing is typed or submitted during "Check login page". It clicks an opener at most once. Labels are at most 60 characters and never a value.
- A guess never clicks a control whose text contains: `forgot`, `reset`, `register`, `sign up`, `signup`, `create`, `join`, `guest`, `show`, `hide`, `cancel`, `back`, `google`, `facebook`, `apple`, `microsoft`, `log out`, `logout`, `sign out`.
- Login words: `log in`, `login`, `sign in`, `signin`, `submit`, `continue`, `next`, `enter`, `go`, `access`, `your account`. Opener words: `login`, `log in`, `sign in`, `account`.
- Generated selectors are at most 200 characters (the existing `isLoginSelectors` limit) and match exactly one visible control. Box selectors are plain CSS (the login matches boxes with `el.matches`). Button and opener selectors may use Playwright text selectors (`firstVisible` accepts them).
- Exact-wording matches (`NEXT_WORDS`, `OPEN_WORDS`) and the owner's stored selectors always win over a guess.
- Any page script with named inner functions needs `NAME_SHIM` first (tsx). No new dependencies. Use npm, not pnpm. Never touch the owner's `.env`.
- Two branches and two PRs to `develop`: `feature/login-guess` (Tasks 1 to 3, from `develop` after committing the spec and this plan), then `feature/login-check` (Tasks 4 to 7, from `feature/login-guess`; retarget its PR to `develop` once the first is merged).
- Existing Linux-only login browser tests (`login.browser.test.ts`) must still pass. They are skipped on macOS: run them where the repo's CI runs them (Linux), for example in Docker.

## Review Focus

- A form holding both "Forgot password" and "Login": only Login is pressed.
- A page with a newsletter box and a search box next to the login form: the button chosen is in the login's own form.
- A page whose only button is "Sign up" or "Register": no click, and the login ends as `form_not_found` with a reason, never a wrong press.
- Inspecting a page with no form and no opener, or one that redirects because the profile is already logged in: state `none`, empty lists, no error.
- A control that cannot get a unique selector is not offered, and a saved generated selector works when the login runs on the same page.

---

## Step 1: smarter guessing (branch `feature/login-guess`)

### Task 1: Guess the login button

**Files:**
- Create: `services/browser/src/login-guess.ts`, `services/browser/src/login-guess.test.ts`
- Create: `services/browser/test/login-guess.browser.test.ts`
- Modify: `services/browser/src/login.ts` (`nextButton`, around line 834)

**Interfaces:**
- Produces (`login-guess.ts`):
  ```ts
  export const LOGIN_WORDS: string[];   // the login words above
  export const AVOID_WORDS: string[];   // the avoid words above
  /** Contains a login word and no avoid word, ignoring case and extra spacing. */
  export const looksLikeLogin: (text: string) => boolean;
  /** Contains an avoid word. */
  export const isAvoided: (text: string) => boolean;
  /** The control that submits `field`'s form, or null. Visible, enabled controls only. */
  export async function guessSubmit(frame: Frame, field: Locator): Promise<Locator | null>;
  ```

- [ ] **Step 1: Write failing unit tests** in `login-guess.test.ts`: `looksLikeLogin` is true for "login to your account", "Sign in securely", "  LOG   IN ", "Continue" and false for "Forgot password?", "Register", "Sign up to our newsletter", "Continue with Google", "Log out", "Search". `isAvoided` is true for "Create account", "Show password", "Back", "Sign out" and false for "Sign in".
- [ ] **Step 2: Write failing browser tests** in `login-guess.browser.test.ts`. It starts its own small http server (the pattern of `login.browser.test.ts`: one path per case, a good login sets a `sid` cookie and `/account` needs it) and calls `runLogin(page, request, { settleMs: 1500, stepWaitMs: 4000, formWaitMs: 4000 })` on a plain Chromium page, not Linux-gated. Cases, each expecting `"ok"` unless stated:
  - `button-outside-submit`: username and password in a `<form>`, press control is `<button type="button" onclick="this.form.submit()">login to your account</button>`.
  - `link-button`: the control is `<a class="btn" role="button" href="#" onclick="document.forms[0].submit()">Sign in securely</a>`.
  - `forgot-and-login`: the form holds `<a href="/forgot">Forgot password</a>`, `<button type="button">Register</button>` and the login button. Expect `"ok"` and that `/forgot` and register were never requested (count them on the server).
  - `newsletter-neighbour`: a search box and a newsletter form with a "Subscribe" button sit beside the login form. Expect `"ok"` and no newsletter post.
  - `only-signup`: the form's only control is `<button type="button">Sign up</button>`. Expect `"form_not_found"` and that nothing was posted.
- [ ] **Step 3: Run** `npx vitest run --exclude '.claude/**' services/browser/src/login-guess.test.ts services/browser/test/login-guess.browser.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 4: Implement `login-guess.ts` and wire it.** `guessSubmit` runs one `field.evaluate` that returns a mark (the same pattern as `MARK_ATTR`, a `data-sm-pick` number) for the control to press, then returns `frame.locator('[data-sm-pick="n"]')`. In page: the container is the field's `form`, else the nearest ancestor (at most 4 up) holding a visible clickable control. Candidates are `button`, `input[type=submit|button]`, `[role=button]` and links with `role=button` or a class matching `/btn|button/i`; visible and enabled; text is `innerText`, then `value`, then `aria-label`, then `title`. Drop avoided ones. Choose the single candidate that looks like login (several: the first one after the field in document order); else the only remaining `button` in the container; else null. Pass the word lists in as regex sources. In `nextButton`, after the existing `findButton(page, named)` fallback returns null, return `guessSubmit(frame, field)`; the override and both earlier tries are untouched.
- [ ] **Step 5: Run the Step 3 command.** Expected: PASS. Then `npm run typecheck` and `npm run lint`: clean.
- [ ] **Step 6: Commit** (`feat: guess the login button when its wording is not on the list`).

### Task 2: Guess the opener, popups and multi-step logins

**Files:**
- Modify: `services/browser/src/login-guess.ts`, `services/browser/src/login.ts` (`waitForForm` and the opener step, around lines 543 and 640)
- Modify: `services/browser/test/login-guess.browser.test.ts`

**Interfaces:**
- Consumes: `looksLikeLogin`, `isAvoided`, `guessSubmit` (Task 1).
- Produces:
  ```ts
  /** (login-guess.ts) The visible control that opens the login, or null. */
  export async function guessOpener(page: Page): Promise<Locator | null>;
  /** (login.ts, exported) The owner's opener, else an exact-wording one, else a guess. */
  export async function findOpener(page: Page, override?: string): Promise<Locator | null>;
  ```

- [ ] **Step 1: Add failing browser cases** to `login-guess.browser.test.ts`, same harness:
  - `long-opener`: the login page shows no form, only a header link "Customer login" that reveals the form. Expect `"ok"`.
  - `icon-link-opener`: the opener is `<a href="/account/login"></a>` with an icon and no text, on a page whose form lives at that address. Expect `"ok"`.
  - `popup-form`: the opener "My account area" opens a modal whose form fades in after 700 ms (`opacity` transition). Expect `"ok"`.
  - `two-step-popup`: the opener opens a modal with an email box and a "Continue" button; the password box appears in the same modal after that. Expect `"ok"`.
  - `logout-is-not-an-opener`: a logged-out page whose only header control is "Log out" and "Register". Expect `"form_not_found"` and no click on either.
- [ ] **Step 2: Run** the browser test file. Expected: new cases FAIL.
- [ ] **Step 3: Implement `guessOpener`** with one in-page evaluate: visible `a`, `button` and `[role=button]` whose text (or `aria-label`, or `title`) contains an opener word and no avoid word, shortest text first; a link with no text counts when its `href` contains `login`, `signin` or `account`. Mark and return as in Task 1. Add `findOpener` to `login.ts` and use it in `waitForForm` and the opener step where `findButton(page, whole(OPEN_WORDS))` is called today. The override path is unchanged.
- [ ] **Step 4: Run** `npx vitest run --exclude '.claude/**' services/browser/test/login-guess.browser.test.ts services/browser/src`. Expected: PASS. `npm run typecheck`, `npm run lint`: clean.
- [ ] **Step 5: Commit** (`feat: guess the login opener, including popups and two-step forms`).

### Task 3: Step 1 wrap-up

**Files:** `docs/status.md` (one line).

- [ ] **Step 1: Run** `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:integration`, and `npm run test:browser` (on macOS the Linux-gated login tests skip). Expected: all pass. Say plainly what skipped.
- [ ] **Step 2: Run the Linux-gated login tests** where they can run: build the service image as CI does (`docker build -f services/browser/Dockerfile -t stock-monitor-browser:test .`) and run `login.browser.test.ts` and `login-guess.browser.test.ts` inside it with the repo's test command (see `.github/workflows/ci.yml`, job `browser`). Expected: PASS. If it cannot be run, say so in the PR.
- [ ] **Step 3: Try it on the real supplier pages** with a throwaway script: for EFG's login page, check that without its typed selectors the guess finds "login to your account"; report what it found (read-only, no credentials).
- [ ] **Step 4: Commit status line, push `feature/login-guess`, open a PR to `develop`** with a detailed description and no Claude attribution (owner's git preference). Do not merge: the owner says "merge".

---

## Step 2: "Check login page" (branch `feature/login-check`)

### Task 4: What a login would use, and every candidate

**Files:**
- Create: `services/browser/src/login-inspect.ts`, `services/browser/src/login-inspect.test.ts`
- Create: `services/browser/test/login-inspect.browser.test.ts`
- Modify: `services/browser/src/login.ts` (export `findFields`, `nextButton`, `challengeVisible`, types `Found` and `Fields`)

**Interfaces:**
- Consumes: `findFields`, `findOpener`, `nextButton`, `challengeVisible`, `LoginSelectors` from `@stock-monitor/supplier-session`.
- Produces:
  ```ts
  export type InspectControl = { label: string; selector: string };
  export type LoginInspection = {
    state: "form" | "opener" | "none" | "captcha" | "unreachable";
    /** The opener was clicked to show the form. */
    opened: boolean;
    found: Record<"open" | "account" | "username" | "password" | "submit", InspectControl | null>;
    fields: InspectControl[];   // at most 40
    buttons: InspectControl[];  // at most 40
  };
  export type InspectRequest = { loginUrl: string; checkUrl: string; stealth: boolean; selectors?: LoginSelectors };
  /** Pure: an id that looks written by a person, not generated (`#UserName` yes, `#ember123` and `#:r1:` no). */
  export const stableId: (id: string) => boolean;
  export async function inspectLogin(page: Page, request: InspectRequest, opts?: { formWaitMs?: number; stepWaitMs?: number }): Promise<LoginInspection>;
  ```

- [ ] **Step 1: Write failing unit tests** for `stableId` (`UserName`, `customer-email`, `login_btn` true; `ember123`, `:r1:`, `a1b2c3d4e5f6`, empty, ids over 60 characters false).
- [ ] **Step 2: Write failing browser tests** (own fixture server, plain Chromium page, no credentials):
  - `form page`: state `form`, `opened: false`; `found.username` and `found.password` labels and selectors set; `found.submit.label` is "login to your account"; `fields` and `buttons` hold the visible candidates only.
  - `opener page`: a header link reveals the form; state `form`, `opened: true`, `found.open` set.
  - `nothing typed`: after any inspection the fixture server received no post, and every input's value is still empty.
  - `no form, no opener`: state `none`, lists empty.
  - `already logged in`: the login address redirects to `/account`: state `none`.
  - `captcha`: a visible challenge widget gives state `captcha`.
  - `unique selectors`: for every control offered, `document.querySelectorAll(selector)` finds exactly one visible match, and two identical "Submit" buttons without ids are not offered.
  - `round trip`: take `found.username.selector`, `found.password.selector` and `found.submit.selector` from the inspection, pass them as `selectors` to `runLogin` on the same fixture: result `"ok"`.
- [ ] **Step 3: Run** `npx vitest run --exclude '.claude/**' services/browser/src/login-inspect.test.ts services/browser/test/login-inspect.browser.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement `login-inspect.ts`.** Load `request.loginUrl` as `runLogin` does (a 5xx, 429 or no answer gives `unreachable`; a challenge gives `captcha`). If `findFields` finds no username, password or account box, look for `findOpener(page, selectors.open)`: click it once, wait with the same form wait, set `opened`; no opener and no box gives `none`; an opener whose click shows no box gives `opener`. `found.*` come from `findFields` and `nextButton(page, frame, lastBox, selectors.submit)`, so they are what a login would do. `fields` are the visible, non-hidden, non-checkbox inputs; `buttons` are visible buttons, `input[type=submit|button]`, `[role=button]` and links with button classes, minus avoided ones are kept (the owner may still choose them) but listed after the rest. One in-page evaluate per list builds `{ label, selector }`: label from label text, placeholder, name, then aria-label for a box; text, value, then aria-label for a button; cut to 60 characters. Box selector: `#id` if `stableId`, else `input[name="…"]`, else `input[placeholder="…"]`, else `input[aria-label="…"]`. Button selector: `#id`, else `button:has-text("…")` (or `a:has-text`, `input[value="…"]`). Escape quotes. Verify each selector matches exactly one visible element in its frame and is at most 200 characters; drop the control otherwise. Type nothing, submit nothing.
- [ ] **Step 5: Run the Step 3 command.** Expected: PASS. `npm run typecheck`, `npm run lint`: clean.
- [ ] **Step 6: Commit** (`feat: inspect what a login would use on a supplier's login page`).

### Task 5: The service route and the client method

**Files:**
- Modify: `services/browser/src/profile-check.ts`, `services/browser/src/service.ts`, `services/browser/src/server.ts`
- Modify: `packages/browser-client/src/client.ts`, `packages/browser-client/src/client.test.ts`
- Modify: `services/browser/src/server.test.ts`

**Interfaces:**
- Consumes: `inspectLogin`, `InspectRequest`, `LoginInspection` (Task 4).
- Produces:
  ```ts
  // profile-check.ts: createProfileChecker(...) result gains
  inspect(request: InspectRequest): Promise<LoginInspection>;   // in the supplier's profile, through inTurn
  // server.ts: POST /login/inspect, body InspectRequest, answers 200 LoginInspection, 400 invalid_request, 500 inspect_failed
  // client.ts:
  export type InspectCallOutcome = { ok: true; inspection: LoginInspection } | { ok: false; reason: "unavailable" | "failed" | "not_supported" };
  // BrowserClient gains: inspectLogin(request: { loginUrl: string; checkUrl: string; stealth: boolean; selectors?: LoginSelectors }): Promise<InspectCallOutcome>;
  // BrowserClientOptions gains: inspectTimeoutMs?: number   // default 90_000
  ```
  `LoginInspection` and `InspectControl` are mirrored in `client.ts` (the package does not depend on the service), validated on arrival by a small `isInspection` guard.

- [ ] **Step 1: Write failing tests.** `server.test.ts`: `/login/inspect` needs the control token like the other routes, rejects a body without `loginUrl`, `checkUrl` or boolean `stealth` with 400, rejects selectors failing `isLoginSelectors`, answers the fake service's inspection with 200, and answers 500 `inspect_failed` when the service throws; with no `inspectLogin` dependency the route does not exist (404). `client.test.ts`: `inspectLogin` posts to `/login/inspect` with the token, returns `{ ok: true, inspection }` for a valid answer, `not_supported` for 404, `failed` for 400/500 or an answer that fails `isInspection`, `unavailable` when the service does not answer, and uses `inspectTimeoutMs`.
- [ ] **Step 2: Run** `npx vitest run --exclude '.claude/**' services/browser/src/server.test.ts packages/browser-client`. Expected: FAIL.
- [ ] **Step 3: Implement.** `inspect` in `profile-check.ts` follows `login` there exactly (stealth refusal, `profileDirFor(baseDir, request.checkUrl)`, `holdProfile`, `seedProfile` for a new profile, `launch`, `connectOverCDP`, `shimPage`, `inTurn`), runs `inspectLogin` with a 60 s deadline, and writes no failure screenshot. A held profile or a refused stealth answers state `unreachable`. Wire `inspectLogin` into `service.ts` next to `login` (profile mode only) and add the route in `server.ts` with a `parseInspect` guard like `parseLogin`. Log only the state, never labels.
- [ ] **Step 4: Run the Step 2 command.** Expected: PASS. `npm run typecheck`, `npm run lint`: clean.
- [ ] **Step 5: Commit** (`feat: browser service route and client method to inspect a login page`).

### Task 6: The API route

**Files:**
- Modify: `apps/api/src/routes/suppliers.ts` (inside the auto-login block that already needs `credentials`, `key` and `queue`), `apps/api/src/app.ts` and `apps/api/src/index.ts` (pass the browser client to the supplier routes)
- Modify: `apps/api/test/suppliers.int.test.ts`

**Interfaces:**
- Consumes: `BrowserClient.inspectLogin` (Task 5).
- Produces: `POST /api/suppliers/:id/auto-login/inspect`, body `{}`, answers 200 `{ inspection: LoginInspection }`; 401 without a session; 404 `supplier_not_found`; 409 `no_permission` when `automationPermission` is not `granted`; 503 `browser_unavailable` ("The browser service did not answer. Try again in a minute.") for `unavailable`, `failed` and `not_supported`; 400 `invalid_input` for any body key. It calls `inspectLogin({ loginUrl: supplier.loginUrl ?? supplier.websiteUrl, checkUrl: supplier.websiteUrl, stealth: supplier.stealth, selectors: supplier.loginSelectors ?? undefined })`. Audit `supplier.login_inspected` with `{ state, fields, buttons, found }` as counts and a state word only.

- [ ] **Step 1: Write failing integration tests** with a fake browser client: 200 with the inspection and the call made with the supplier's own login address, stealth flag and saved selectors; 401, 404, 409, 503 for each failed outcome, 400; the audit row exists and contains no label text; the route is absent without a browser client.
- [ ] **Step 2: Run** `npx vitest run --exclude '.claude/**' apps/api/test/suppliers.int.test.ts -t inspect`. Expected: FAIL.
- [ ] **Step 3: Implement** the route and wire the browser client in as the other route files get theirs.
- [ ] **Step 4: Run** `npx vitest run --exclude '.claude/**' apps/api/test/suppliers.int.test.ts`. Expected: PASS. `npm run typecheck`, `npm run lint`: clean.
- [ ] **Step 5: Commit** (`feat: API route to check a supplier's login page`).

### Task 7: The list in the login card, and wrap-up

**Files:**
- Modify: `apps/web/src/api.ts`, `apps/web/src/test/fake-api.ts`, `apps/web/src/components/AutoLoginCard.tsx`, `apps/web/src/components/AutoLoginCard.test.tsx`
- Create: `apps/web/src/components/loginPicks.ts`, `apps/web/src/components/loginPicks.test.ts`
- Create: `apps/web/src/components/LoginCheck.tsx`, `apps/web/src/components/LoginCheck.test.tsx`
- Modify: `docs/status.md`

**Interfaces:**
- Consumes: `POST /api/suppliers/:id/auto-login/inspect` (Task 6); existing `api.suppliers.setAutoLogin(id, { loginSelectors })` and the `LoginSelectors` type.
- Produces:
  ```ts
  // api.ts: types InspectControl, LoginInspection mirroring Task 4; SuppliersApi gains
  inspectLogin(id: string): Promise<LoginInspection>;
  // loginPicks.ts
  export type Role = "open" | "account" | "username" | "password" | "submit";
  /** "auto" stores nothing; "none" stores nothing; any other string is a selector. */
  export type Pick = "auto" | "none" | string;
  export const ROLES: { role: Role; label: string }[];   // Open login button, Account field, Username field, Password field, Login button
  /** The picks that carry a selector, as LoginSelectors, or null when there are none. */
  export const selectorsFromPicks: (picks: Record<Role, Pick>) => LoginSelectors | null;
  /** The starting pick for a role: the saved selector if it is a candidate or else "saved:<selector>", otherwise "auto". */
  export const startingPicks: (saved: LoginSelectors | null | undefined, inspection: LoginInspection) => Record<Role, Pick>;
  // LoginCheck.tsx
  export function LoginCheck(props: { api: Api; supplier: Supplier; onSaved: () => void }): JSX.Element;
  ```

- [ ] **Step 1: Write failing tests.**
  - `loginPicks.test.ts`: `selectorsFromPicks` drops `auto` and `none`, keeps selectors, returns null when nothing is picked; `startingPicks` keeps a saved selector that is a candidate, keeps one that is not as `saved:…`, and defaults to `auto`.
  - `LoginCheck.test.tsx`: pressing "Check login page" calls `api.suppliers.inspectLogin(supplier.id)` and shows one row per role, each dropdown starting at "Automatic: (what was found)"; a role the check did not find shows "Not found" and a plain note to pick one; the open row appears only when the check found an opener (`opened: true` or `found.open`); choosing a candidate and pressing "Save" calls `setAutoLogin(id, { loginSelectors: { username: "#UserName" } })` and `onSaved`; picking "Automatic" for everything saves `loginSelectors: null`; state `captcha`, `unreachable` and `none` each show their own plain sentence; a failed call shows the error notice; nothing is saved without pressing Save.
  - `AutoLoginCard.test.tsx`: the five typed selector boxes are inside an "Advanced" disclosure and still save as before; "Check login page" is disabled with the reason when "Allows automatic checks" is not Yes.
- [ ] **Step 2: Run** `npx vitest run --exclude '.claude/**' apps/web/src/components`. Expected: FAIL.
- [ ] **Step 3: Implement** `api.ts` (types, `inspectLogin`), the fake-api default, `loginPicks.ts`, `LoginCheck.tsx` (rows built from the existing `Select`, `Field`, `Notice` and `Button`), and put the list and the "Advanced" disclosure into `AutoLoginCard.tsx`. Invoke `ui-ux-pro-max` and `design-taste-frontend` as CLAUDE.md requires, reuse existing components and tokens, no new design tokens. The role dropdown lists "Automatic: (found label)", then each candidate by label, then "Not on this page".
- [ ] **Step 4: Run** `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:integration`, `npm run test:browser`. Expected: all pass. Say plainly what skipped.
- [ ] **Step 5: Try it** on the owner's local stack the way earlier projects did (isolated Compose project or a rebuild the owner approves): press "Check login page" for EFG and Dimark, confirm the list matches what a login uses, and that EFG works with all five roles on "Automatic". Say plainly if this could not be run.
- [ ] **Step 6: Update `docs/status.md`, commit, push `feature/login-check`, open a PR** (base `feature/login-guess` until that merges, then retarget to `develop`) with a detailed description and no Claude attribution. Do not merge.

## Self-review notes

- Spec coverage: submit guessing with avoid list (Task 1), opener, popup and multi-step (Task 2), same guessing used by `found` (Task 4), `/login/inspect` (Task 5), client and API with permission gate and counts-only audit (Tasks 5 and 6), the list with "Automatic", "Not found", "Not on this page" and the Advanced disclosure (Task 7). Non-goals untouched: no marker learning, no migration, no AI.
- Names are the same across tasks: `guessSubmit`, `guessOpener`, `findOpener`, `inspectLogin`, `InspectRequest`, `LoginInspection`, `InspectControl`, `InspectCallOutcome`, `selectorsFromPicks`, `startingPicks`, `LoginCheck`.
- Open calls for the builder: exact extra words, how "after the field" is measured, and the list layout. Change a Task 1 or 2 test only if the spec's avoid list demands it.
