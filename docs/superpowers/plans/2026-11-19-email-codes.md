# Email Login Codes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Automatic login types the one-time code that a supplier emails, read from the supplier Gmail over IMAP.

**Architecture:** `POST /login { codeWanted: true }` answers `code_needed` with a `holdId`, and the login waits inside its
browser turn. The worker reads the inbox read-only until a matching code arrives, then calls `/login/:holdId/code`, which
answers the final outcome. A supplier can name its code sender in a new `code_email_from` column.

**Tech Stack:** TypeScript, Playwright/Patchright, Node http, imapflow, mailparser, Drizzle, React.

**Spec:** `docs/superpowers/specs/2026-11-19-email-codes-design.md`

## Global Constraints

- A code, an email's text and an email's subject never go into a log, an audit event, a notice or the database.
- The IMAP mailbox is opened read-only.
- The code reader is on only when `Config.alertEmail` is set. It reads `alertEmail.from` with `alertEmail.appPassword`
  at `imap.gmail.com:993` over TLS.
- Time limits:
  - the hold is 180 s from `code_needed`;
  - the worker waits 150 s and looks every 5 s;
  - `/code` has a 120 s deadline in the service, and the client waits 150 s;
  - the login up to the code box keeps its 150 s deadline.
- An email counts only when Gmail's INTERNALDATE is at or after the login's start minus 30 s.
- A code is 4 to 8 characters: digits only, or capitals and digits with at least one digit.
- New dependencies are pinned exactly, to a version released at least 2 weeks ago.
- No supplier names in repo files. No Claude attribution lines in commits.

## Review Focus

- **Two code emails from the same supplier, and the older one is from before this login.** The older code is never used. Task 2 test.
- **The worker dies while a hold is open.** The page closes and the profile is let go after 180 s, and the next login is not told the profile is busy. Task 4 test.
- **A wrong code.** The supplier shows the code box again with an error, the result is `code_required`, and nothing is typed twice. Task 3 test.
- **A forwarded email whose From is another domain than the supplier's site, and no Code email sender is set.** It is not used, and the log says `sender_mismatch seen=<domain>`. Task 2 test.
- **A hold whose `/code` arrives twice.** The second call gives 404 or 409, never a second typing. Task 4 test.

---

### Task 1: Finding a code and matching the sender

**Files:**
- Create: `apps/worker/src/code-mail.ts` and `apps/worker/src/code-mail.test.ts`

**Interfaces:**
- Produces:
  - `findCode(text: string): string | null`
  - `siteOf(host: string): string`: the registrable part, two labels, or three for a `co.uk`-style suffix. It is the same rule as `siteOf` in `services/browser/src/login.ts`.
  - `senderMatches(from: string, websiteUrl: string, override: string | null): boolean`. `from` is an address. `override` is a domain, which matches by site, or a full address, which must match exactly, ignoring case.

- [ ] Unit tests for `findCode`:
  - `"Your verification code is 482913."` gives `"482913"`.
  - `"Use code: AB12CD to sign in"` gives `"AB12CD"`.
  - `"OTP 7731"` gives `"7731"`.
  - `"Order 12345678 shipped"` gives null: there is no code word, and the number is not 6 digits.
  - `"Hello 123456 regards"` gives `"123456"`: the only 6-digit number.
  - `"Codes 111111 and 222222"` with no code word gives null: two candidates.
  - A code word with a 9-digit number gives null.
  - `"Your code is ABCDEF"` gives null: it has no digit.
- [ ] Unit tests for `senderMatches`:
  - `"noreply@mail.acme.co.uk"` against `https://www.acme.co.uk/` is true.
  - `"x@acme.com"` against `https://shop.acme.co.uk/` is false.
  - The override `"login.example.net"` matches `"a@login.example.net"` and `"a@x.example.net"`.
  - The override `"codes@example.net"` matches only that address.
  - Display-name forms (`"Acme <noreply@acme.com>"`) are handled by the caller: these tests take a bare address.
- [ ] Watch them fail, implement, watch them pass, then commit.

### Task 2: The IMAP code reader

**Files:**
- Create: `apps/worker/src/code-reader.ts` and `apps/worker/src/code-reader.test.ts`
- Modify: `apps/worker/package.json` (add `imapflow` and `mailparser`, exact versions)

**Interfaces:**
- Consumes Task 1.
- Produces:
  - `type Mail = { from: string; arrived: Date; subject: string; text: string }`
  - `type MailSource = (since: Date) => Promise<Mail[]>`, which returns the mail since that time, newest first.
  - `createImapSource(c: { user: string; appPassword: string }): MailSource`. It uses imapflow, `mailboxOpen("INBOX", { readOnly: true })`, a search with `since`, fetches the source, then mailparser `simpleParser` for `text`, with `html` turned into text when there is no plain text. It logs out each call.
  - `waitForCode(source: MailSource, q: { since: Date; websiteUrl: string; sender: string | null; timeoutMs: number; pollMs: number; log: (line: string) => void; now?: () => number; sleep?: (ms: number) => Promise<void> }): Promise<string | null>`
- `waitForCode` writes exactly one log line per wait. These are the formats from the spec:
  - `code: found from=<domain> waited=<s>s`
  - `code: no_email waited=<s>s`
  - `code: no_code_in_email from=<domain>`
  - `code: sender_mismatch seen=<domain>`
  - `code: imap_failed reason=<code>`

- [ ] Unit tests with a fake `MailSource` and a fake clock:
  - A matching email on the second poll gives its code, and the log says `found`.
  - Two matching emails: the newest wins.
  - An email that arrived before `since` is ignored even when it matches.
  - A non-matching sender only: null after the timeout, and the log says `sender_mismatch seen=other.com`.
  - A matching email with no code: null, and the log says `no_code_in_email`.
  - A source that throws `{ code: "EAUTH" }`: it keeps trying until the timeout, then returns null with `imap_failed reason=EAUTH`.
  - The log line never contains the code or the subject.
- [ ] Pick versions: run `npm view imapflow time --json` and `npm view mailparser time --json`, and take the newest release at least 14 days old. Install with `--save-exact -w @stock-monitor/worker`, then check `npm ls`.
- [ ] Watch the tests fail, implement, watch them pass, then commit. `createImapSource` has no unit test: it is a thin adapter, and the owner's local test covers it.

### Task 3: runLogin waits for a code and types it

**Files:**
- Modify: `services/browser/src/login.ts`
- Test: `services/browser/test/login.browser.test.ts` (Linux only)

**Interfaces:**
- Produces `StepOptions.awaitCode?: () => Promise<string | null>`.

- [ ] Behaviour:
  - Where the loop returns `code_required` for a code box with no username or password box, and after the submit where `decided === "code_required"` and `codeFieldVisible`: if `awaitCode` is set, `const code = await awaitCode()`.
  - `null` gives `code_required`.
  - Otherwise, type the code into the code box (or one character per box when the box has `maxlength=1` and is followed by boxes like it), read it back, and press the step's submit button, or Enter when there is none. Then decide with `decideAfterSubmit` and confirm on the check page as after a password.
  - A code box that is still there after the submit, with no ok, gives `code_required`.
  - The code is typed once. The reason line adds `code_typed len=<n>` and never the code.
- [ ] Fixture paths in the test server:
  - `codeA`: username and password, then a page with `<input autocomplete="one-time-code">`. Code `482913` leads to the account page, anything else back to the code page with "Wrong code".
  - `codeB`: username, then Next, then the same code page with no password box.
  - `codesplit`: six `maxlength=1` boxes.
- [ ] Browser tests:
  - `codeA` with `awaitCode` giving `"482913"` is ok, with one POST holding the code.
  - `codeB` is ok.
  - `codesplit` is ok, and the posted boxes join to `482913`.
  - A wrong code gives `code_required`, with the code posted once.
  - `awaitCode` giving null gives `code_required`, with no code posted.
  - Without `awaitCode`, `codeA` gives `code_required` as today.
- [ ] Run them in the Playwright container, with the repo copied in and no node_modules:

  ```bash
  docker run --rm -v "$PWD":/src:ro mcr.microsoft.com/playwright:v1.65.0-noble bash -lc \
    'cp -r /src /w && cd /w && rm -rf node_modules && npm ci && npx playwright install chromium && \
     xvfb-run -a npx vitest run --no-file-parallelism services/browser/test/login.browser.test.ts'
  ```

  Expected: every test passes, the new ones included.
- [ ] Commit.

### Task 4: The browser service holds the login

**Files:**
- Modify: `services/browser/src/server.ts`, `services/browser/src/profile-check.ts`
- Test: `services/browser/src/server.test.ts`

**Interfaces:**
- Consumes `awaitCode` from Task 3.
- Produces these HTTP routes:
  - `POST /login` accepts `codeWanted?: true` in `parseLogin`. It answers either the final `LoginOutcome`, or `{ result: "code_needed", holdId }` with a uuid.
  - `POST /login/:holdId/code` takes `{ code }`, where `code` matches `/^[A-Za-z0-9]{4,8}$/`. It answers the final `LoginOutcome`. An unknown or used hold gives 404, and a bad body gives 400.
  - `POST /login/:holdId/cancel` gives 204, or 404.
- Produces `ControlServerOptions.login` type `(r: LoginRequest, o?: { awaitCode?: () => Promise<string | null> }) => Promise<LoginOutcome>`. In `profile-check.ts` it is passed to `runLogin`, inside the same `inTurn`.

- [ ] Server unit tests, with a fake `login` that calls `awaitCode` and resolves after it:
  - Without `codeWanted`, there is one answer and the outcome.
  - With `codeWanted`, a login that never asks gives the outcome directly.
  - With `codeWanted`, a login that asks answers `code_needed`. `/code` then passes the code to `awaitCode` and answers the final outcome.
  - A second `/code` gives 404.
  - `/cancel` makes `awaitCode` resolve null, and gives 204.
  - With no call for 180 s (a fake timer, or an injected `holdMs`), `awaitCode` resolves null and the hold is gone (404).
  - A bad code body gives 400.
  - The log never holds the code.
- [ ] Commit.

### Task 5: Client and worker

**Files:**
- `packages/browser-client/src/client.ts` and its test
- `apps/worker/src/auto-login.ts`
- `apps/worker/src/index.ts`
- `apps/worker/test/auto-login.int.test.ts`
- `packages/db/src/schema.ts`, migration `0020_code_email_from.sql`, `packages/db/src/supplier-repository.ts`

**Interfaces:**
- Consumes Tasks 2 and 4.
- Produces:
  - `LoginRequest.codeWanted?: true`
  - `LoginOutcome.result` may be `"code_needed"`, with `holdId: string`
  - `BrowserClient.sendCode(holdId, code): Promise<LoginCallOutcome>`, with a 150 s timeout
  - `BrowserClient.cancelCode(holdId): Promise<void>`, which never throws
  - `AutoLoginDeps.codes?: { source: MailSource }`
  - `SupplierRecord.codeEmailFrom: string | null`
- Migration 0020:

  ```sql
  ALTER TABLE suppliers ADD COLUMN code_email_from text;
  ALTER TABLE suppliers ADD CONSTRAINT suppliers_code_email_from CHECK (code_email_from IS NULL OR char_length(code_email_from) BETWEEN 3 AND 254);
  ```

- [ ] Client unit tests:
  - `code_needed` with a holdId parses.
  - `code_needed` with no holdId is `failed`.
  - `sendCode` posts to `/login/<id>/code`.
  - `cancelCode` posts to `/cancel` and swallows errors.
- [ ] Worker int tests, with a fake browser whose `login` answers `code_needed`, and a fake `MailSource`:
  - A code found gives `sendCode` with that code, the final ok saves the session, and the result is `"ready"`.
  - No code gives `cancelCode` and `code_required` as today: a failed count and the `code_required` notice.
  - Without `deps.codes`, `codeWanted` is not sent.
  - `codeEmailFrom` set on the supplier is used as the sender override.
  - The repo reads and writes `codeEmailFrom`.
- [ ] `ensureLoggedIn`: `since = new Date(now() - 30_000)`, taken before `browser.login`. Then `waitForCode` with timeout 150 s and poll 5 s, and log through `logger.info({ supplierId }, line)`.
- [ ] `index.ts`: when `config.alertEmail` is set, pass `codes: { source: createImapSource({ user: alertEmail.from, appPassword: alertEmail.appPassword }) }` to every deps object that runs `ensureLoggedIn`: supplierVerify, autoLoginTest, extractionChecks and scheduling where they log in.
- [ ] Commit.

### Task 6: Code email sender on the supplier page

**Files:**
- The API route that sets the logged-in marker (find it with `grep -rn loggedInMarker apps/api/src/routes`) and its int test
- `apps/web/src/api.ts`
- `apps/web/src/components/AutoLoginCard.tsx` and its test
- `apps/web/src/test/fake-api.ts`

- [ ] API test: `codeEmailFrom: "login.example.net"` or `"codes@example.net"` is stored and returned. `null` clears it. `"not a domain"` and a 300-character value give 400.
- [ ] Web test: the Automatic login card shows a "Code email sender" box with the hint from the spec, shows the saved value, and Save sends `codeEmailFrom`. Use the card's existing Field pattern. Load the UI skills first (CLAUDE.md).
- [ ] Commit.

### Task 7: Docs

- [ ] In `docs/deployment.md`, under Automatic login, add a "Suppliers that email a code" section covering:
  - It needs the Email alerts settings.
  - Setting the Gmail filter in the owner's own email: Settings > Filters > "From: the supplier's address" > Forward to the supplier Gmail. The forwarding address must be confirmed first, with a code Gmail sends to the supplier Gmail.
  - For a supplier with no password, save any word as the password: it is never typed when the page asks only for a code.
  - What each `code:` log line means.
  - When to fill **Code email sender**.
- [ ] Run `npm run check`, then commit.
