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

No spoofing, no flags hidden, no solving. The profile is kept while the saved session is unchanged, and replaced after a new login.

## Limits

- Title only: no HTTP status (the log shows `httpStatus: null`) and no page text, so `ok` means "looks like the real page".
- One check at a time, about 900 MB each.
- The profile holds cookies on a memory-backed disk, lightly encrypted by Chromium's fixed key. Fine for a spike on one Mac. Not a design for keeping sessions.
- Reading a page's content (needed for stock) still needs something to control the browser. This spike only answers whether the page LOADS.

## How to try it (owner)

1. `git switch spike/persistent-profile`
2. In `.env` add `VERIFY_MODE=profile` (only that line).
3. `docker compose up -d --build`
4. Click Check connection on the blocked supplier and on the working one.

Result to record here: the supplier's result and what the audit event shows.
