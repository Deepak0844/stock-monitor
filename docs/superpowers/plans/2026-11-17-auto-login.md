# Automatic Supplier Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per supplier, the app logs in with a saved (sealed) username and password before a run and once mid-run, hands
over to the owner on a puzzle or code, and can optionally hide automation (stealth) for that supplier.

**Architecture:** Credentials are sealed in a new `supplier_credentials` table and only unsealed in the worker. A new browser
service endpoint `POST /login` fills the login form in the supplier's persistent profile and returns a fresh session on
success. The worker's new `ensureLoggedIn` runs at the start of stock and link runs and once on a mid-run `login_required`.
Stealth swaps the CDP driver to Patchright for flagged suppliers only.

**Tech Stack:** TypeScript, Node 22, npm workspaces, Drizzle + Postgres, pg-boss, Fastify (API), React + Tailwind (web),
Playwright Chromium (browser service), Patchright (slice 2), Vitest.

**Spec:** `docs/superpowers/specs/2026-11-17-auto-login-design.md`. Read it before any task.

## Global Constraints

- Branch `feature/auto-login` off `develop`. Conventional commits (`feat`, `fix`, `test`, `docs`, `chore`). **No
  Co-Authored-By or "Generated with" lines** in commits or PRs.
- npm only, never pnpm. Never touch the owner's `.env`. Never put a real supplier's name or domain in repo files.
- A password or username never appears in a log line, audit detail, API response, error message, notification, or the
  browser service's disk. Errors are logged by `error.name` only, as the code does today.
- Both `auto_login` and `stealth` require `suppliers.automation_permission = 'granted'` (database check).
- One login attempt per browser request. The service never retries. The worker never retries `wrong_password`, `captcha`,
  `code_required` or `blocked`.
- Pause after **2** failed automatic logins in a row (`too_many_failures`); `wrong_password` and `account_locked` pause at once.
- `AUTO_LOGIN_FRESH_MINUTES = 10` (constant, `apps/worker/src/auto-login.ts`).
- Typing delay per key: random 40 to 120 ms. Two-step login: wait up to 15 s for the password field. Settle: 12 s (the
  profile checker's `settleMs`).
- Puzzles are never solved or clicked. No puzzle-solving services.
- Stealth never disables the Chromium sandbox or the seccomp profile. If Patchright cannot run under them, stop and report.
- Full check before each commit that touches code: `npm run typecheck && npm run lint && npm run test:unit`. Integration
  tests (`npm run test:integration`) need the test Postgres the existing `packages/db/test/harness.ts` uses.

## Review Focus

1. **Login page that is already logged in** (profile still has a live session): `/login` must return `ok` without typing
   anything. Test in Task 3.
2. **Owner logs in through the live window while an automatic login runs**: the owner's session must win. Test in Task 5.
3. **Supplier changes the login form** so the saved `login_selectors` no longer match: `form_not_found`, never a guess.
   Test in Task 3.
4. **Owner revokes permission** while `auto_login` is on: both switches go off in the same transaction, the next run does
   not log in. Test in Task 7.
5. **Password with unusual characters** (quotes, emoji, 200 chars): sealed and typed exactly. Tests in Tasks 1 and 3.

---

## Slice 1: Automatic login (no stealth)

### Task 1: Seal and unseal credentials

**Files:**
- Create: `packages/supplier-session/src/credentials.ts`
- Create: `packages/supplier-session/src/credentials.test.ts`
- Modify: `packages/supplier-session/src/index.ts` (export)

**Interfaces:**
- Produces:
  - `type Credentials = { username: string; password: string; account?: string }`
  - `isCredentials(v: unknown): v is Credentials` (username and password strings 1 to 200 chars; `account` absent or a string 1 to 200; no other keys)
  - `sealCredentials(c: Credentials, key: Buffer, keyId: string): Encrypted`
  - `unsealCredentials(sealed: Encrypted, key: Buffer): Credentials` (throws on a bad shape)
  - `type LoginSelectors = { open?: string; account?: string; username?: string; password?: string; submit?: string }` and
    `isLoginSelectors(v: unknown): v is LoginSelectors` (only those keys, each a non-empty string up to 200 chars)

- [ ] **Step 1: Write failing tests** in `credentials.test.ts`:
  - `round-trips exactly`: `unsealCredentials(sealCredentials({ username: "a@b.c", password: "p\"'😀" + "x".repeat(190) }, key, "k1"), key)` equals the input.
  - `ciphertext holds no plain text`: the sealed `ciphertext` does not contain the username or password.
  - `rejects bad shapes`: `isCredentials({ username: "", password: "x" })`, `{ username: "a", password: "x".repeat(201) }`, `{ username: "a", password: "b", extra: 1 }`, `{ username: "a", password: "b", account: "" }` are all false; `{ username: "a", password: "b", account: "C-1042" }` is true and round-trips.
- [ ] **Step 2: Run** `npx vitest run packages/supplier-session/src/credentials.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** using `encrypt`/`decrypt` from `@stock-monitor/crypto`, the same way `seal.ts` does.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(supplier-session): seal supplier credentials`.

### Task 2: Database: credentials table, supplier columns, notification reasons

**Files:**
- Modify: `packages/db/src/schema.ts` (`suppliers`, `notifications`, new `supplierCredentials`)
- Create: `packages/db/drizzle/0016_auto_login.sql` (via `npm run db:generate`, then review it)
- Create: `packages/db/src/supplier-credentials-repository.ts`
- Modify: `packages/db/src/supplier-repository.ts` (`SupplierRecord` fields, new methods)
- Modify: `packages/db/src/notification-repository.ts` (`NotificationReason`)
- Modify: `packages/db/src/index.ts` (exports)
- Test: `packages/db/test/supplier-credentials-repository.int.test.ts`, `packages/db/test/supplier-repository.int.test.ts`, `packages/db/test/schema.int.test.ts`

**Interfaces:**
- Consumes: `Encrypted` from `@stock-monitor/crypto`.
- Produces:
  - Table `supplier_credentials(supplier_id uuid pk → suppliers.id on delete cascade, ciphertext, iv, tag, key_id text not null, saved_at timestamptz not null default now())`.
  - `suppliers` columns: `auto_login boolean not null default false`, `stealth boolean not null default false`,
    `login_selectors jsonb null`, `auto_login_failures integer not null default 0`, `auto_login_paused_reason text null`,
    `last_auto_login_at timestamptz null`, `last_auto_login_result text null`.
  - Checks: `suppliers_auto_login_permission`: `not auto_login or automation_permission = 'granted'`;
    `suppliers_stealth_permission`: `not stealth or automation_permission = 'granted'`;
    `suppliers_auto_login_paused_reason`: null or in `('wrong_password', 'account_locked', 'too_many_failures')`;
    `suppliers_last_auto_login_result`: null or one of the 9 `LoginResult` codes (Task 3).
  - `notifications_reason` check and `NotificationReason` gain `'code_required' | 'wrong_password' | 'account_locked' | 'form_not_found'`.
  - `createSupplierCredentialsRepository(db)` → `{ save(supplierId, sealed: Encrypted): Promise<{ savedAt: Date }>; getSealed(supplierId): Promise<Encrypted | null>; savedAt(supplierId): Promise<Date | null>; remove(supplierId): Promise<boolean> }`. `save` upserts and also resets `auto_login_failures = 0` and `auto_login_paused_reason = null` in one transaction.
  - `SupplierRecord` gains `autoLogin: boolean; stealth: boolean; loginSelectors: LoginSelectors | null; autoLoginFailures: number; autoLoginPausedReason: "wrong_password" | "account_locked" | "too_many_failures" | null; lastAutoLoginAt: Date | null; lastAutoLoginResult: string | null`.
  - `LoginSelectors` is imported from `@stock-monitor/supplier-session` (Task 1), so the browser service never depends on `@stock-monitor/db`.
  - Supplier repository methods:
    - `setAutoLogin(id, patch: { autoLogin?: boolean; stealth?: boolean; loginSelectors?: LoginSelectors | null }): Promise<SupplierWrite | { ok: false; reason: "not_granted" | "no_credentials" }>`. Turning `autoLogin` on needs a credentials row.
    - `recordAutoLogin(id, result: string, outcome: "reset" | "failed" | "pause_wrong_password" | "pause_account_locked" | "unchanged"): Promise<SupplierRecord>`. Sets `last_auto_login_at = now()` and `last_auto_login_result`. `reset` sets failures to 0; `failed` adds 1 and sets `too_many_failures` when it reaches 2; `pause_wrong_password` / `pause_account_locked` add 1 and set `wrong_password` / `account_locked`.
    - `resumeAutoLogin(id): Promise<boolean>`. Failures 0, pause null.
  - The existing permission update (where `automation_permission` is written) sets `auto_login = false, stealth = false` in the same statement when the new value is not `granted`.

- [ ] **Step 1: Write failing integration tests**:
  - credentials repo: `save` then `getSealed` returns the same `Encrypted`; `savedAt` set; `remove` deletes; deleting the supplier cascades.
  - schema: inserting a supplier with `auto_login = true` and permission `unknown` fails with the check name `suppliers_auto_login_permission`; same for `stealth`.
  - supplier repo: `setAutoLogin(id, { autoLogin: true })` returns `no_credentials` without a row and `not_granted` without permission; `recordAutoLogin(id, "captcha", "failed")` twice gives `autoLoginPausedReason: "too_many_failures"`; `"pause_wrong_password"` once gives `"wrong_password"`; `"pause_account_locked"` once gives `"account_locked"`; `resumeAutoLogin` clears both; credentials `save` clears both.
  - permission revoke: with `autoLogin` and `stealth` on, setting permission to `not_granted` leaves both false.
- [ ] **Step 2: Run** `npm run test:integration -- packages/db`. Expected: FAIL.
- [ ] **Step 3: Implement** schema, generate migration `0016_auto_login`, repositories.
- [ ] **Step 4: Run** `npm run db:migrate` against the test DB, then `npm run test:integration -- packages/db`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(db): store sealed supplier credentials and auto-login state`.

### Task 3: Browser service: log in inside the persistent profile

**Files:**
- Create: `services/browser/src/login.ts` (pure helpers, injected into the page)
- Create: `services/browser/src/login.test.ts`
- Modify: `services/browser/src/profile-check.ts` (new `login` on the object `createProfileChecker` returns)
- Create: `services/browser/test/login.browser.test.ts` (+ fixture pages in the same style as the other `*.browser.test.ts` files)

**Interfaces:**
- Consumes: `classifyPage`, `PageClass`, `SessionState` from `@stock-monitor/supplier-session`; `CHALLENGE_WIDGET` from `verify.ts`; `profileDirFor`, `holdProfile`, `releaseProfile` from `profile-store.ts`.
- Produces:
  - `type LoginResult = "ok" | "captcha" | "code_required" | "wrong_password" | "account_locked" | "blocked" | "form_not_found" | "unreachable" | "unknown"`
  - `type LoginRequest = { loginUrl: string; checkUrl: string; username: string; password: string; account?: string; stealth: boolean; selectors?: LoginSelectors }`
  - `type LoginOutcome = { result: LoginResult; state?: SessionState }` (`state` only when `ok`)
  - `type AfterSubmitFacts = { challengeVisible: boolean; codeFieldVisible: boolean; secondCheckText: boolean; lockedText: boolean; passwordFieldVisible: boolean; onLoginPage: boolean; pageClass: PageClass }`. `secondCheckText`: visible text matches `SECOND_CHECK_WORDS` (approve, check your phone, sent a notification, check your email, verify). `lockedText`: visible text matches `LOCKED_WORDS` (account is locked, account locked, too many attempts, temporarily blocked).
  - `decideAfterSubmit(f: AfterSubmitFacts): LoginResult`. Order: challenge → `captcha`; code field or approve/check-email text → `code_required`; locked text → `account_locked`; password visible and on login page → `wrong_password`; else `pageClass` mapped (`login_required` → `wrong_password`, `ok` → `ok`, others as named, `unknown` → `unknown`). The order is fixed by the spec.
  - `CODE_FIELD`: a selector string for `input[autocomplete="one-time-code"]` plus inputs whose `name`, `id`, `placeholder` or `aria-label` matches `/code|otp|verification/i` (matched in-page, visible only).
  - `profileChecker.login(request: LoginRequest): Promise<LoginOutcome>`.

**Behavior of `login`** (spec section 2, steps 1–7):
- Uses `profileDirFor(baseDir, request.loginUrl)`. If `holdProfile` fails, return `unreachable`.
- **Does not wipe or re-seed the profile.** The point is a returning browser.
- Opens with the debugging channel, like `inProfile`. Goes to `loginUrl`. If `classifyPage` already says `ok` there, skip the form.
- Form finding: the spec's **step loop** ("Finding the login form"), exactly. Fields are searched in **every frame**
  (`page.frames()`), visible only. At most 5 steps; the "open the login" click at most once; the cookie-banner click at
  most once per login; each step waits up to 15 s for the page or visible fields to change; a step where nothing changed
  ends the loop with `form_not_found`. An account field is filled (spec step-loop rule 2, checked before the username rule) only when `request.account` is set.
  An override selector (`open`, `account`, `username`, `password`, `submit`) replaces its
  automatic rule; an override not found → `form_not_found`, no guessing. After the password step, click a visible
  "Yes" / "Stay signed in" button if one appears.
- Keep the button and label word lists as exported constants in `login.ts` (`OPEN_WORDS`, `NEXT_WORDS`,
  `USE_PASSWORD_WORDS`, `CONSENT_WORDS` (Accept, Accept all, Allow all, Agree, No thanks, Close, ×), `STAY_SIGNED_IN_WORDS`, `REMEMBER_ME_WORDS`,
  `SECOND_CHECK_WORDS`, `LOCKED_WORDS`), copied from the spec's "Every login case" tables.
- Before the step loop: if the page is a "checking your browser" interstitial (classifier says `blocked` and no form is
  visible), wait up to 15 s for it to pass by itself, then classify again. Still `blocked` → return `blocked`.
- Once the password has been submitted, never type the username again.
- On `ok`, read `context.storageState()` **while the debugging channel is still open** and keep its `origins` (page
  storage); after the clean quit, merge in the cookie file's cookies as below.
- Type with `locator.pressSequentially(value, { delay })`, delay random 40–120 ms per call.
- After submit: wait for navigation or 12 s, gather `AfterSubmitFacts`, `decideAfterSubmit`.
- If `ok`, load `checkUrl`, classify. Only `ok` stays `ok`. Any other class there becomes `unknown`: the form went through
  but the site still wants a login, which is not proof the password is wrong.
- On `ok`, quit cleanly, then state = `mergeSessionState(storageState, { cookies: readCookies(cookieStore(profile)), origins: [] }, Date.now() / 1000)` (the merge keeps `storageState.origins` when the cookie file has none); write the profile's
  `seeded` marker as `cookieHash(state.cookies)` so the next check does not re-seed it.
- Never log `username` or `password`. Errors: return `unknown`, log `error.name` only.

- [ ] **Step 1: Write failing unit tests** (`login.test.ts`) for `decideAfterSubmit`: one case per row of the order above,
  including "challenge and code both visible → `captcha`" and "pageClass `login_required` → `wrong_password`".
- [ ] **Step 2: Run** `npx vitest run services/browser/src/login.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `login.ts`.
- [ ] **Step 4: Run** it. Expected: PASS.
- [ ] **Step 5: Write failing browser tests** (`login.browser.test.ts`), local fixture server, real Chromium:
  - `logs in on a one-step form`: form sets cookie `sid` on correct password; outcome `ok`, `state.cookies` has `sid`.
  - `two-step login`: username page then password page; `ok`.
  - `choice screen`: email → "Use password" button → password; `ok`.
  - `modal by auto rule`: password field hidden until a "Sign in" button is clicked; `ok`.
  - `modal by override`: the opener is an icon with no text, `selectors.open = "#acct"`; `ok`.
  - `form in iframe`: the form is in an `<iframe>` on the login page; `ok`.
  - `cookie banner`: a fixed overlay covers the form until "Accept all" is clicked; `ok`, and "Accept all" clicked once.
  - `stay signed in`: after the password, a "Stay signed in?" page with a "Yes" button; `ok`.
  - `account number`: form with customer number + email + password; all three arrive; `ok`.
  - `account box, none saved`: same form, no `account` in the request; `form_not_found`.
  - `browser check page`: an interstitial page that redirects to the form after 3 s; `ok`.
  - `push approval`: after the password, "We sent a notification, approve on your phone"; `code_required`.
  - `account locked`: after the password, "Your account is locked"; `account_locked`.
  - `token in page storage`: the fixture's app keeps its token in `localStorage`; `state.origins` holds it.
  - `no username after password`: a security-question text box after the password is left empty; result `unknown`.
  - `loop limit`: a page that keeps showing a new empty username step; `form_not_found` after 5 steps (fixture counts ≤ 5 submits).
  - `already logged in`: second call with the same profile types nothing (fixture counts POSTs: still 1); `ok`.
  - `wrong password`: fixture re-renders the form with an error; `wrong_password`.
  - `puzzle`: fixture shows a visible element matching `CHALLENGE_WIDGET`; `captcha`, no `state`.
  - `code`: fixture shows `<input autocomplete="one-time-code">`; `code_required`.
  - `selector override not found`: `selectors.username = "#nope"`; `form_not_found`.
  - `exact typing`: password `p"'😀` + 190 × `x` arrives at the fixture byte-for-byte.
  - `password never logged`: capture everything passed to the service's `log`; it contains neither value.
- [ ] **Step 6: Run** `npm run test:browser -- services/browser/test/login.browser.test.ts`. Expected: FAIL, then implement `login` in `profile-check.ts`, then PASS.
- [ ] **Step 7: Commit** `feat(browser): log in to a supplier inside its persistent profile`.

### Task 4: `/login` route and browser client

**Files:**
- Modify: `services/browser/src/server.ts` (route, request parser, logging)
- Modify: `services/browser/src/service.ts` (wire `profileChecker.login`)
- Modify: `services/browser/src/server.test.ts`
- Modify: `packages/browser-client/src/client.ts`, `client.test.ts`

**Interfaces:**
- Consumes: `LoginRequest`, `LoginOutcome` (Task 3).
- Produces:
  - `ControlServerOptions.login?: (r: LoginRequest) => Promise<LoginOutcome>`; route `POST /login`, same token check.
  - `parseLogin(raw: string): LoginRequest | null`: `loginUrl` and `checkUrl` pass `isWebUrl`; `username`/`password` 1–200
    chars; `account` optional, 1–200; `stealth` boolean; `selectors` optional, checked with `isLoginSelectors` (Task 1); no other keys.
  - Log line on success: `login: <result>` only. On error: `login failed: <error.name>`, reply 500 `{ error: "login_failed" }`.
  - `BrowserClient.login(r: LoginRequest): Promise<{ ok: true; outcome: LoginOutcome } | { ok: false; reason: "unavailable" | "failed" }>`, using `pageTimeoutMs`. `failed` when status ≠ 200 or `result` is not one of the 9 codes. `state` is kept only when `result === "ok"` and `isSessionState`.

- [ ] **Step 1: Write failing tests**:
  - server: 401 without token; 400 for each bad field (empty password, 201-char username, extra key, `ftp:` URL); 200
    passes the parsed request to `login`; the `log` spy never receives the password (`"s3cret-test"`); a throwing `login`
    gives 500 `login_failed` and logs only the error name.
  - client: maps 200 to `{ ok: true, outcome }`; drops `state` when `result` is `captcha`; network error → `unavailable`; bad
    `result` → `failed`.
- [ ] **Step 2: Run** `npx vitest run services/browser/src/server.test.ts packages/browser-client`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** again. Expected: PASS.
- [ ] **Step 5: Commit** `feat(browser): add the login endpoint and client call`.

### Task 5: Worker: `ensureLoggedIn`

**Files:**
- Create: `apps/worker/src/auto-login.ts`
- Create: `apps/worker/test/auto-login.int.test.ts`
- Modify: `apps/worker/src/supplier-verify.ts` (messages for the new reasons in `raiseNeedsAttention`)

**Interfaces:**
- Consumes: `BrowserClient.login` (Task 4); `createSupplierCredentialsRepository`, `recordAutoLogin` (Task 2);
  `unsealCredentials` (Task 1); `sealSessionState`; `supplierSessions.getSealed`, `save`, `refresh`; `raiseNeedsAttention`.
- Produces:
  - `export const AUTO_LOGIN_FRESH_MINUTES = 10`
  - `export type AutoLoginDeps = SessionRefreshDeps & { suppliers; supplierCredentials; browser: BrowserClient; notifications; now?: () => Date }`
  - `export async function ensureLoggedIn(deps: AutoLoginDeps, supplier: SupplierRecord, opts: { force: boolean; checkUrl: string }): Promise<"ready" | "skipped" | StopReason>` (`StopReason` from `extraction-check.ts`).

**Behavior** (spec section 4 table, exactly):
- `skipped` when `!supplier.autoLogin` or `supplier.autoLoginPausedReason`.
- `ready` without a call when `!force` and the session's `lastVerifiedAt` is within `AUTO_LOGIN_FRESH_MINUTES`.
- Before calling, read `getSealed(supplierId)?.iv` (may be null). After `ok`, save the sealed new state: if there was a row,
  `refresh(id, thatIv, …)` (compare-and-swap; on `false` keep the owner's and still return `ready`); if there was none,
  `save`. Then `markVerified`.
- Result → `recordAutoLogin` outcome: `ok` → `reset`; `captcha`/`code_required`/`blocked`/`form_not_found`/`unknown` →
  `failed`; `wrong_password` → `pause_wrong_password`; `account_locked` → `pause_account_locked`; `unreachable` or client `unavailable` → `unchanged`.
- Result → return: `ok` → `ready`; `captcha` → `captcha`; `blocked` and `account_locked` → `blocked`; `code_required`, `wrong_password`,
  `form_not_found`, `unknown` → `login_required`; `unreachable`/`unavailable` → `unreachable`.
- Notices via `raiseNeedsAttention` with reason `captcha`, `blocked`, `code_required`, `wrong_password`, `account_locked` or `form_not_found`
  (`unknown` uses `login_required`). Messages (exact copy):
  - `code_required`: "The supplier asked for a code. Log in in the live window and type it there."
  - `wrong_password`: "The supplier refused the saved password. Automatic login is paused until you save it again."
  - `account_locked`: "The supplier says the account is locked. Automatic login is paused. Unlock it on the supplier's site, then press Resume."
  - `form_not_found`: "Automatic login could not find the login form. Set the login page fields on the supplier page."
- Audit `supplier.auto_login` with details `{ result, stealth }` only.
- A thrown error: log `error.name`, return `unreachable`, record `unchanged`.

- [ ] **Step 1: Write failing integration tests** with a fake `BrowserClient` (as other worker int tests do):
  - `skips when off` / `skips when paused`: no `login` call.
  - `fresh session`: `lastVerifiedAt` 5 min ago, `force: false` → `ready`, no call. 11 min ago → call.
  - one test per result row: return value, `autoLoginFailures`, pause reason, notification reason.
  - `two failures pause`: two `captcha` results → `too_many_failures`; a third call → `skipped`.
  - `owner wins`: fake `login` replaces the session row (simulating a live-window login) before returning `ok`; the
    stored session is the owner's afterwards; result `ready`.
  - `no secrets`: the audit rows' details and every logger call contain neither the username nor the password.
- [ ] **Step 2: Run** `npm run test:integration -- apps/worker/test/auto-login.int.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** again. Expected: PASS.
- [ ] **Step 5: Commit** `feat(worker): log in automatically when a supplier needs it`.

### Task 6: Worker: call it from runs, skip the early check, add the test job

**Files:**
- Modify: `apps/worker/src/extraction-check.ts`, `apps/worker/src/mapping-link-check.ts`
- Modify: `apps/worker/src/scheduling-tick.ts`
- Modify: `packages/queue/src/jobs.ts` (`"supplier.session.login": z.object({ supplierId: z.uuid() }).strict()`)
- Modify: `apps/worker/src/worker.ts` (register handler)
- Test: `apps/worker/test/extraction-check.int.test.ts`, `mapping-link-check.int.test.ts`, `scheduling-tick.int.test.ts`, `worker.int.test.ts`

**Interfaces:**
- Consumes: `ensureLoggedIn` (Task 5).
- Produces: job `supplier.session.login`; handler `createAutoLoginTestHandler(deps)` in `auto-login.ts`.

Rules:
- Start of run, after the gate: `ensureLoggedIn(force: false, checkUrl: first mapping URL of the run)`. A `StopReason`
  stops the run with that reason, using the existing stop path. `skipped`/`ready` continue.
- On a page result `login_required` with `autoLogin` on and not yet re-logged this run: `ensureLoggedIn(force: true)`,
  then retry the same page once. A second `login_required` in the run stops it as today. `captcha` and `blocked` stop at
  once with no login.
- `scheduling-tick.ts`: no early `supplier.session.verify` for suppliers with `autoLogin && !autoLoginPausedReason`.
- Test job: skip in quiet hours and while the supplier has a running `check_runs` row; else `ensureLoggedIn(force: true, checkUrl)` where `checkUrl` is the first enabled mapping's URL, else `websiteUrl` (spec "Calls left to the builder").

- [ ] **Step 1: Write failing tests**:
  - stock run with auto-login on and a stale session calls `login` once before the first page.
  - stock run where page 2 returns `login_required`: one `login` call, page 2 retried, run completes.
  - page 2 and page 4 both `login_required`: one `login`, run stops `login_required`.
  - page `captcha`: no `login` call, run stops.
  - link run: same start-of-run call.
  - tick: early check queued for a normal supplier, not for an auto-login one, queued again once it is paused.
  - test job: refused in quiet hours (no `login` call).
- [ ] **Step 2: Run** `npm run test:integration -- apps/worker`. Expected: new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** again. Expected: all PASS.
- [ ] **Step 5: Commit** `feat(worker): log in before and during runs`.

### Task 7: API

**Files:**
- Modify: `apps/api/src/routes/suppliers.ts`
- Modify: `apps/api/src/app.ts` (logger redact paths, `supplierCredentials` dependency)
- Test: `apps/api/test/suppliers.int.test.ts`

**Interfaces:**
- Consumes: Task 1 sealing, Task 2 repositories, job `supplier.session.login` (Task 6).
- Produces (all owner-only, existing CSRF and origin checks):
  - `PUT /api/suppliers/:id/credentials` `{ username, password, account? }` (validated with `isCredentials`) → 200 `{ savedAt }`.
  - `DELETE /api/suppliers/:id/credentials` → 204; also `setAutoLogin(id, { autoLogin: false })`.
  - `PATCH /api/suppliers/:id` additionally accepts `autoLogin`, `loginSelectors` (`stealth` comes in Task 11). `not_granted` →
    409 `{ error: "not_granted", message: "Mark this supplier as allowing automatic checks first." }`; `no_credentials` →
    409 `{ error: "no_credentials", message: "Save a username and password first." }`.
  - `POST /api/suppliers/:id/auto-login/test` → 202, queues `supplier.session.login`. Rate limit: 1 per minute per supplier (existing `rate-limit.ts`).
  - `POST /api/suppliers/:id/auto-login/resume` → 204.
  - Supplier JSON gains `autoLogin, stealth, loginSelectors, credentialsSavedAt, lastAutoLoginAt, lastAutoLoginResult, autoLoginPausedReason`.
  - Redact `req.body.username`, `req.body.password` in the API logger.
  - Audit `supplier.credentials_saved` / `supplier.credentials_removed`, no details.

- [ ] **Step 1: Write failing tests**:
  - PUT saves; the response body, the GET supplier body and the audit rows never contain the password.
  - PUT with a 201-char password → 400.
  - PATCH `autoLogin: true` → 409 `no_credentials`, then after PUT → 409 `not_granted` (permission unknown), then after
    granting → 200.
  - granting then revoking permission → GET shows `autoLogin: false`.
  - test endpoint queues one job; second call within a minute → 429.
  - resume clears `autoLoginPausedReason`.
  - captured API log output contains no password after a PUT.
- [ ] **Step 2: Run** `npm run test:integration -- apps/api/test/suppliers.int.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** again. Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): save credentials and control automatic login`.

### Task 8: Web: the "Automatic login" card

Invoke `ui-ux-pro-max` and `design-taste-frontend` before this task. Match the existing Tailwind look of the supplier pages.

**Files:**
- Create: `apps/web/src/components/AutoLoginCard.tsx`, `AutoLoginCard.test.tsx`
- Modify: `apps/web/src/pages/SupplierFormPage.tsx` (render the card when editing an existing supplier)
- Modify: `apps/web/src/api.ts` (calls and `Supplier` fields)

**Interfaces:**
- Consumes: Task 7 routes and fields.
- Produces: `<AutoLoginCard supplier={Supplier} onChange={() => void} />`.

Behavior (spec section 6 sketch, without the stealth row):
- Username and password inputs are always empty after load and after save; "Password saved <date>" shows from `credentialsSavedAt`.
- Switch disabled with "Needs “Allows automatic checks” to be Yes." when permission is not `granted`.
- Paused: "The supplier refused the saved password" / "Two automatic logins failed in a row" + **Resume**.
- Last result line: "Last automatic login: <date time>, <plain result>". Plain results: ok "logged in", captcha "puzzle shown",
  code_required "asked for a code", wrong_password "password refused", account_locked "account locked", blocked "blocked", form_not_found "login form not
  found", unreachable "could not reach the site", unknown "not sure it worked".
- "Login page fields (advanced)" collapsed by default; five text inputs (Open login button, Account field, Username field, Password field, Login button) mapped to `loginSelectors` `open`, `account`, `username`, `password`, `submit`. An optional "Account number" input sits above Username and is cleared after save like the others.
- **Test login now** posts to the test route and shows "Test started. The result shows here in a minute."

- [ ] **Step 1: Write failing tests** (React Testing Library, as the other page tests do): fields empty after save; switch
  disabled without permission; paused text + Resume calls the route; advanced section collapsed; result copy for
  `code_required`; axe has no violations.
- [ ] **Step 2: Run** `npx vitest run apps/web/src/components/AutoLoginCard.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** again, then `npm run typecheck && npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): add the automatic login card`.

### Task 9: Docs for slice 1, and the slice 1 PR

**Files:** `README.md`, `docs/status.md`, `docs/deployment.md`, `docs/pilot-flow.md`

- [ ] **Step 1:** Replace the old "decided against" automatic-login line in `docs/status.md` with the new rule and a link to the spec.
- [ ] **Step 2:** Add "Automatic login" to `docs/deployment.md`: how to turn it on, the terms risk, what each paused state means, the advanced fields.
- [ ] **Step 3:** Run `npm run check`. Expected: PASS. Then `npm run test:browser`. Expected: PASS.
- [ ] **Step 4: Commit** `docs: explain automatic login`.
- [ ] **Step 5:** Push and open a PR into `develop` with a detailed description: summary, what changed, verification, risks, out of scope (stealth). Merge once CI is green.

### Task 12: Logged-in marker

Spec section 6b. Runs after the slice 1 final-review fix wave, before the slice 1 PR.

**Files:**
- Modify: `packages/db/src/schema.ts`, new migration `packages/db/drizzle/0017_logged_in_marker.sql`, `packages/db/src/supplier-repository.ts` (`SupplierRecord.loggedInMarker: string | null`, `setAutoLogin` patch accepts `loggedInMarker`)
- Modify: `packages/supplier-session/src/classify.ts` (`PageFacts.loggedInMarker?: string`)
- Modify: `services/browser/src/server.ts` (`loggedInMarker?` on `/check-page`, `/capture`, `/login`, 1–200 chars), `verify.ts`, `capture.ts`, `profile-check.ts`, `login.ts` (pass it to every `classifyPage` call)
- Modify: `packages/browser-client/src/client.ts` (pass-through)
- Modify: `apps/worker/src/auto-login.ts`, `extraction-check.ts`, `mapping-link-check.ts`, `supplier-verify.ts` (send `supplier.loggedInMarker ?? undefined`)
- Modify: `apps/api/src/routes/suppliers.ts` (PATCH `loggedInMarker`: string 1–200 or null; returned in supplier JSON)
- Modify: `apps/web/src/components/AutoLoginCard.tsx` (field in the advanced section, exact label "Only shows when logged in", hint "Text you see only when logged in, like 'Log out' or your account name")
- Modify: `docs/deployment.md` (one paragraph in "Automatic login")

**Interfaces:**
- `classifyPage({ ..., loggedInMarker?: string })`: if set and the result would be `ok`, return `login_required` with signal `marker_missing` unless `normalise(page.text)` contains `normalise(loggedInMarker)`.

- [ ] **Step 1: Write failing tests**: classifier — ok page without marker → `login_required`/`marker_missing`; with marker (different case, extra spaces) → `ok`; captcha page with marker set → still `captcha`; marker unset → unchanged. Browser test — a fixture whose product page is public and shows "Log out" only with the session cookie: `/login` with `loggedInMarker: "Log out"` and a wrong password → not `ok`. API — PATCH saves/clears it; 201 chars → 400. Worker — the marker is sent on capture and login. Card — the field saves through PATCH.
- [ ] **Step 2: Run** the affected suites. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run check` and the touched browser test. Expected: PASS.
- [ ] **Step 5: Commit** `feat: per-supplier logged-in marker`.

## Slice 2: Stealth

### Task 10: Patchright in the browser service

**Files:**
- Modify: `services/browser/package.json` (add `patchright`, exact pinned version, at least two weeks old)
- Modify: `services/browser/Dockerfile` (only if Patchright needs its own browser download; prefer reusing Playwright's Chromium via `executablePath`)
- Modify: `services/browser/src/profile-check.ts` (pick the driver per request)
- Modify: `services/browser/src/config.ts` (stealth needs timezone and language)
- Modify: `services/browser/src/server.ts` (`stealth?: boolean` on `/check-page` and `/capture`)
- Test: `services/browser/test/login.browser.test.ts`, `services/browser/test/container.docker.test.ts`, `services/browser/src/config.test.ts`

**Interfaces:**
- Produces: `driverFor(stealth: boolean): typeof import("playwright").chromium` (Patchright's `chromium` when true). Used for every `connectOverCDP` in `profile-check.ts`. `CheckPageRequest` and `CaptureRequest` gain `stealth?: boolean`.
- A stealth request when `BROWSER_TIMEZONE` or `BROWSER_LANGUAGE` is blank → outcome `unknown` and log
  `stealth refused: timezone and language must be set`.

- [ ] **Step 1: Write failing tests**:
  - browser test: a fixture page posts back `navigator.webdriver`; `false` with `stealth: true`, and the current value without.
  - config test: stealth refusal when timezone is blank.
  - container test: with the new image, the sandbox and seccomp checks that exist today still pass.
- [ ] **Step 2: Run** `npm run test:browser -- services/browser/test/login.browser.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** If Patchright fails under the sandbox or seccomp profile, **stop and report**. Do not loosen either.
- [ ] **Step 4: Run** the browser and container tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(browser): optional stealth driver per supplier`.

### Task 11: Stealth switch through worker, API, screen, docs

**Files:**
- Modify: `apps/worker/src/auto-login.ts`, `extraction-check.ts`, `mapping-link-check.ts` (pass `stealth: supplier.stealth` on `login`, `checkPage`, `capture`)
- Modify: `packages/browser-client/src/client.ts` (`stealth` passthrough on `checkPage`, `capture`)
- Modify: `apps/api/src/routes/suppliers.ts` (`PATCH` accepts `stealth`, same 409 `not_granted`)
- Modify: `apps/web/src/components/AutoLoginCard.tsx` (the "Hide automation (stealth)" row from the spec sketch)
- Modify: `README.md`, `docs/status.md`, `docs/deployment.md`, `docs/pilot-flow.md` (spec section 7)
- Test: the matching test files from Tasks 5–8

- [ ] **Step 1: Write failing tests**: worker sends `stealth: true` on all three calls for a stealth supplier and `false`
  otherwise; API refuses `stealth: true` without permission; the card's stealth switch is disabled without permission.
- [ ] **Step 2: Run** the affected suites. Expected: FAIL.
- [ ] **Step 3: Implement**, and make the doc edits from spec section 7 (README line "never hides that it is a program",
  `docs/status.md` "No spoofing, stealth or captcha solving, ever", `docs/pilot-flow.md` line 335, terms-risk warning).
- [ ] **Step 4: Run** `npm run check && npm run test:browser`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: stealth switch per supplier`, then push and open the slice 2 PR into `develop` with a detailed description. Merge on green.

## Done when

- On the short-session supplier, two daily runs in a row succeed with nobody logging in (owner confirms).
- On one supplier that refused slice 1's login, stealth either lets the login through or the result is recorded.
- `npm run check`, `npm run test:browser`, `npm run test:container` all pass on the branch.
