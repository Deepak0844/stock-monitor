# Keep supplier logins alive, and warn before a run

Date: 2026-11-13. Size: small change (short design).

## Why

The owner logs in to each supplier by hand in the live window. The app saves those cookies and uses them for every check. When a
login expires, the app only finds out when a scheduled run meets a login page. The run stops, and the owner learns afterwards.

Many supplier sites extend a session on each visit and send fresh cookies. The app throws those fresh cookies away. So a session
can expire even though the app visits it every day.

## Goals

1. **Refresh:** after a check that found a logged-in page, save the cookies the browser ended up with, in place of the old ones.
2. **Early warning:** check the login a while before each scheduled run. If it has expired, the owner gets the usual "needs you
   to log in again" notice in time to reconnect before the run.

## Non-goals

- Logging in automatically with a saved username and password. It would mean storing supplier passwords, and logins with a
  captcha would still need the owner. The project never solves or bypasses captchas.
- Email or push notices. The warning uses the existing dashboard notice (owner's choice, 2026-11-13). Email can be a later change.
- Beating a fixed session limit. A supplier that ends every session after N days still needs the owner to log in again.

## Anti-goals (a failure even if it works)

- Saving cookies from a logged-out, captcha or blocked page over a good session.
- An older refreshed session overwriting a newer login the owner just made.
- Cookies or session details reaching logs, the audit log or the browser service's disk outside the existing profile store.
- Visiting a supplier during its quiet hours.

## Approaches

| Approach | Trade-off | Verdict |
| --- | --- | --- |
| **A. Return the refreshed state from every check** (verify, check-page, capture) and save it in the worker | Every visit keeps the session fresh. Touches three endpoints and two modes | **Picked** |
| B. A separate "refresh" endpoint run on a timer | One new path. Refreshes only when the timer fires, and adds visits | Dropped: more visits for less effect |
| C. Auto-login with stored credentials | Fully hands-off where it works | Dropped: see non-goals |

For the early warning: run a session check a set time before each scheduled run, from the existing scheduler tick. A separate
fixed daily check was dropped because it is not tied to when runs happen.

## Design

### Browser service (`services/browser`)

- Each check outcome gets an optional `state` (the same `SessionState` shape the login window returns). It is set **only** when
  `result` is `ok`.
- Headless mode (`verify.ts`, `capture.ts`): read `context.storageState()` before closing the context.
- Profile mode (`profile-check.ts`): after the browser quits cleanly, read the profile's cookies with the existing
  `chromium-cookies.ts` reader, as the plain login window already does. Where the debugging channel is open (`inProfile`, used
  by link and stock checks), read `context.cookies()` instead. Write the new cookies' hash to the profile's `seeded` marker,
  so the next check does not re-seed (and wipe) a profile that is already current.
- The service still never holds the sealing key. It returns plain state to the worker, as `finishSession` already does.

### Browser client (`packages/browser-client`)

- Pass `state` through on `verify`, `checkPage` and `capture` outcomes.

### Worker (`apps/worker`)

- One shared helper: `saveRefreshedSession(supplierId, startedFrom, state)`. It seals `state` and saves it **only if** the stored
  session is still the one the check started from (compare and swap on the session row). If the owner reconnected in the
  meantime, it drops the refreshed state.
- **Merge, never replace blindly.** A cookie in the new state replaces the old one with the same name, domain and path. An old
  cookie missing from the new state is kept unless it has expired. This guards against a cookie file that leaves out
  session-only cookies, which would silently log the supplier out. `origins` are kept from the old state when the new state has
  none (profile mode never has any).
- The compare-and-swap key is the session row's `state_iv`, which is new on every seal. (`saved_at` was the first idea, but
  Postgres keeps microseconds and a JavaScript `Date` keeps milliseconds, so it would never match.) A refresh does **not** change
  `saved_at`, so the page still shows when the owner last logged in. It updates `cookie_count`, `domains`, `size_bytes` and `last_verified_at`. Two refreshes racing (a run
  and a check) are both valid, so the last one wins.
- It skips the write when the merged cookies are unchanged (same hash), but still updates `last_verified_at`.
- It records `supplier.session_refreshed` in the audit log, with no cookie names or values.
- Callers: `supplier-verify.ts` after an `ok` check. `extraction-check.ts` and `mapping-link-check.ts` save once at the end of a run,
  using the last `ok` state, not after every page.

### Early warning (`scheduling-tick.ts`)

- For each scheduled supplier that passes the stock gate: if its next run is within `SESSION_CHECK_LEAD` (2 hours, owner's choice), and
  `last_verified_at` is older than the start of that window, queue `supplier.session.verify`. A run that ends on an `ok` page
  also sets `last_verified_at`, so a supplier checked every hour gets no extra visit: the last run already proved the login.
- **At most one early check per upcoming run.** The queue has no de-duplication, and an unreachable or failed check leaves
  `last_verified_at` alone, so without a guard the tick would queue a check every minute. Record the run time the early check was
  queued for (a nullable `session_precheck_for` timestamp on the supplier) and skip when it matches `next_check_at`.
- The early check acts only on `login_required`, `captcha` and `blocked`. An `unknown` page does not mark the supplier: the
  run does not stop on `unknown` either, and the early check must not be stricter than the run it guards.
- If that moment falls in the supplier's quiet hours, skip the early check. The run itself still detects an expired login.
- A failed early check uses the existing `raiseNeedsAttention`: the supplier shows "Needs reconnecting", the dashboard shows a
  notice, and the gate keeps the run from starting.

## Calls left to the builder

- Whether the 2-hour lead is a constant or a setting. Default: a constant.

## How we know it works

- Unit tests: state is returned only on `ok`, in both modes. The marker is updated in profile mode.
- Unit tests: the merge keeps unexpired old cookies, drops expired ones, and keeps `origins`.
- Integration tests: an `ok` check replaces the stored session. A `login_required` check does not. A reconnect during a run is
  not overwritten. No cookie values appear in the audit log or the logs.
- Scheduler test: an early check is queued once in the lead window, never in quiet hours, not again after an unreachable result,
  and not at all when a recent run already proved the login.
- Real-world check: on one pilot supplier that extends sessions, the stored session's cookie expiry moves forward after a check.
