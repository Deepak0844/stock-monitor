# Login detection: smarter guessing and a "Check login page" list

Status: approach agreed with the owner 2026-11-19 (option A). Awaiting approval of this design before a plan is written.

## Why

Automatic login finds the username, password and account boxes by what they are, but it finds buttons only by exact wording from a
short list (`OPEN_WORDS`, `NEXT_WORDS` in `services/browser/src/login.ts`). The owner then has to find CSS selectors by hand.
Evidence from the owner's own audit trail: EFG failed with `form_not_found` 14 times and worked 20 times once three selectors
were typed (`#UserName`, `#Password`, `#dupbtn`, a button reading "login to your account", which is not on the list). Of 56
recorded attempts, 18 were `form_not_found`, the largest failure. At least one supplier shows its sign-in form in a popup, in
several steps. The owner wants this to be friendly and to work with any layout.

## Goals

- Guessing first: a login that finds its boxes today and fails only on a button's wording, or on an opener's wording, now works
  with no setup.
- A list second: when guessing still misses, a "Check login page" button shows what the app found and lets the owner pick the
  right control from a list, with no CSS.
- Popup and multi-step logins keep working, and the same guessing applies to every step.

## Non-goals

- No AI model, and no page text beyond short control labels leaves the browser service.
- No click-in-the-live-window picker (the live Chromium has no control channel).
- No change to captcha, emailed code, wrong-password or locked-account handling.
- No learned logged-in marker. That stays a typed field for now and is a possible later step.
- No database change. Picks are saved in the existing `login_selectors` column.

## Anti-goals

- A guess that clicks "Register", "Forgot password", "Create account", a social login ("Continue with Google") or "Log out" is a
  failure even if the login then works.
- A saved pick that matches more than one control, or that a typed password could land in the wrong box for, is a failure.
- Anything typed or submitted during "Check login page".

## Approaches considered

- **A. Smarter guessing, then a "Check login page" list.** Chosen.
- **B. Only smarter guessing.** Smaller, but leaves the owner stuck when the guess is wrong.
- **C. An AI model reads the login page.** Costs money, sends supplier pages out, not repeatable. Dropped.
- **D. Click the field in the live window.** Needs a new control channel into Chromium. Dropped.

## Design

Two steps, two pull requests.

### Step 1: smarter guessing (`services/browser/src/login.ts`)

1. **Submit button.** `nextButton` keeps its first two tries (the form's real submit control, then a whole-wording match from
   `NEXT_WORDS`). It then tries, in order:
   - the one visible clickable control in the form of the last typed box (button, `input[type=button]`, `[role=button]`, or a
     link styled as a button) whose text contains a login word (`log in`, `login`, `sign in`, `signin`, `submit`, `continue`,
     `next`, `enter`, `go`, `access`, `your account`);
   - the only visible button in that form;
   - when the box has no form: the nearest such control after the box in the same frame, within the same container.
   A control whose text contains an avoid word is never chosen: `forgot`, `reset`, `register`, `sign up`, `signup`, `create`,
   `join`, `guest`, `show`, `hide`, `cancel`, `back`, `google`, `facebook`, `apple`, `microsoft`, `log out`, `logout`, `sign out`.
2. **Opener.** When no whole-wording opener exists, a visible button or link whose text contains `login`, `log in`, `sign in`,
   `account` is used, shortest text first, avoid words excluded as above. A link whose address contains `login`, `signin` or
   `account` counts when it has no text.
3. **Popup and multi-step.** No change to the step loop (up to 5 steps, `waitForForm` waits for a popup to appear or fade in).
   The new guessing is used at every step, including the button after a username-only step.
4. **Owner overrides win.** A stored selector is never guessed around (existing rule).

### Step 2: "Check login page"

1. **Browser service**: `POST /login/inspect` with `{ loginUrl, stealth, selectors? }`. It loads the login page in the supplier's
   profile (same queue and proxy as a login), and, only if no box is visible and an opener is found, clicks that opener once and
   waits as the login does. It types nothing and submits nothing. Deadline 60 s. It answers:
   - `state`: `form`, `opener`, `none`, `captcha` or `unreachable`;
   - `found`: the control the guessing picks for each of `open`, `account`, `username`, `password`, `submit`, or null;
   - `fields` and `buttons`: every visible candidate (at most 40 each), each `{ label, selector }`, where `label` is at most 60
     characters of its own words (label, placeholder, name, or button text) and never a value.
   The guessing used for `found` is the same code the login uses, so the check shows exactly what a login would do.
2. **Generated selectors.** For a box: `#id` when the id looks stable (letters, digits, `-`, `_`, not generated-looking), else
   `input[name="…"]`, else `input[placeholder="…"]`, else `input[aria-label="…"]`. These must be plain CSS, because the login
   matches boxes with `el.matches`. For a button or opener: `#id`, else `button:has-text("…")` style text selectors, which
   `firstVisible` already accepts. Every selector is verified on the page to match exactly one visible control and is at most
   200 characters (the existing limit); a control that cannot get one is not offered.
3. **Client and API**: `BrowserClient.inspectLogin(request)` and `POST /api/suppliers/:id/login-inspect`. Owner only, and only
   when the supplier allows automatic checks, like the login test. No credentials are involved. The audit entry
   `supplier.login_inspected` holds counts only. The page times out the call after 90 s.
4. **Web** (`AutoLoginCard`): a "Check login page" button opens a list with one row per role: Open login button (only when the
   check found the login behind an opener), Account field, Username field, Password field, Login button. Each row is a dropdown:
   "Automatic: (what was found)" first, then the other candidates, then "Not on this page". "Automatic" stores no selector for
   that role, so detection keeps adapting. A role the check found nothing for shows "Not found" and says to pick one. Save writes
   the generated selectors through the existing `setAutoLogin` call. The five typed selector boxes move under an "Advanced"
   disclosure, unchanged.

## Constraints

- Follows existing rules: owner-only routes, nothing typed or logged that is a credential, rules and selectors are data.
- The container runs the service through tsx: any page script with named inner functions needs the existing `NAME_SHIM` first.
- npm workspaces, no new dependencies, branch from `develop`.

## Testing

- Step 1: browser tests with a small fixture server and real Chromium, one fixture per case: a "login to your account" button
  outside a form, a link-styled "Sign in securely" button, an opener reading "Customer login", a popup form that fades in after
  the opener, a two-step email then password form, and a form that also holds "Forgot password" and "Register" controls that must
  not be clicked. The existing login tests must still pass.
- Step 2: a browser test for `/login/inspect` (nothing typed, one opener click at most, selectors unique), unit tests for the
  selector generator, an API integration test, and web component and page tests.

## Left to the builder

The exact word lists beyond those above, how "nearest control" is measured, and the layout of the list.
