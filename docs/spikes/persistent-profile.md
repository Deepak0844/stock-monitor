# Spike: check a supplier from a persistent, ordinary browser

**Status:** built, passes against the fake supplier on Linux. NOT yet tried on a real supplier that blocks the normal check.

## Question

Our normal check opens a fresh, Playwright-controlled headless Chromium and replays the saved cookies. One supplier answers
that with a 403 and a CAPTCHA page, while a person in the plain login window gets in. Does the supplier treat a
long-lived, uncontrolled, headed browser differently?

## What it does (`VERIFY_MODE=profile`)

1. Keeps one Chromium profile per supplier site in the container's memory-backed `/tmp` (lost when the container restarts).
2. Fills it with the saved session's cookies. The debugging channel is open only for this, on a blank page, then the browser quits.
3. Opens the supplier address in an ordinary headed Chromium with no debugging channel, the same way the plain login
   window runs. Waits 12 seconds for the page and any challenge to finish. Quits it cleanly.
4. Reads the page title and final address from the browser's own History. The page is never read while it loads.
5. Calls it `captcha`, `blocked`, `login_required`, `unknown` or `ok` from the title and address alone.
6. **Step 2, only when step 1 says `unknown`** (for example a page with no title): reopens the same profile with a debugging
   channel, loads the page, reads its text, password field and any challenge widget, and runs the normal `classifyPage`. The
   answer then carries the HTTP status. If step 2 cannot read the page, the answer stays `unknown`.

No spoofing, no flags hidden, no solving. The profile is kept while the saved session is unchanged, and replaced after a new login.

## Persistent login profile (`LOGIN_PROFILE=persistent`, plain window only)

Why: each login normally opens a brand-new browser profile and deletes it, so a supplier's captcha sees a first-time visitor
every time (two Shopify suppliers answer "Captcha failed" to a solved puzzle). With this on, the login window uses the same
per-site profile the checks use, so cookies and history from earlier logins are still there for the next one.

- One profile per site (the host), in the container's memory-backed `/tmp/sm-profiles`. It survives between logins and checks
  while the container runs. A restart or rebuild resets it (a disk volume would keep cookies more weakly protected than the sealed database does).
- One browser per profile, so the login window and the checks take turns: a login waits up to a minute for a running check;
  a check that finds the owner logging in to that site answers `unreachable` and changes nothing.
- At the end of a login the profile is marked as holding the session that was just stored, so the next check keeps it, history and all.
- Cache capped at 32 MB per profile. The profile holds more cookies over time (third-party ones too), and they all go into the stored session.
- Whether it improves captcha scores is the question this answers. No promise.

## Limits

- Step 1 is title only: no HTTP status (`httpStatus: null`) and no page text, so `ok` there means "looks like the real page", and a home page that loads for anyone looks the same logged in or out. Point the supplier's check address at a page that needs a login. Step 2 (blank or unclear titles only) reads the text.
- One check at a time, about 900 MB each.
- The profile holds cookies on a memory-backed disk, lightly encrypted by Chromium's fixed key. Fine for a spike on one Mac. Not a design for keeping sessions.
- Reading a page's content (needed for stock) still needs something to control the browser. This spike only answers whether the page LOADS.

## How to try it (owner)

1. `git switch spike/persistent-profile`
2. In `.env` add `VERIFY_MODE=profile` (only that line).
3. `docker compose up -d --build`
4. Click Check connection on the blocked supplier and on the working one.

## Results so far (owner, real suppliers, 2026-11-09)

- The normal headless check: Hancocks gets a 403 and a CAPTCHA page (`httpStatus: 403`).
- `VERIFY_MODE=profile` step 1: Hancocks loads its normal home page with its normal title, no challenge. Bookers, Sain Wholesale, Mon More Confectionery and EFG also load.
- kD Wholesale: its home page has an empty `<title>`, so step 1 said `unknown`. That is what step 2 was added for.
- Not yet known: whether step 2 (a debugging channel) is accepted by Hancocks and the others. That is the next thing to try.

Result to record here: the supplier's result and what the audit event shows.
