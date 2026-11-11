# Spec: import a login from the owner's own browser (DRAFT)

Status: draft, awaiting owner approval. No code until approved.

## Why

Some Shopify supplier stores reject a login made in our live window ("Captcha failed" after the puzzle is solved, then
"too many tries"), but accept the same login in the owner's normal browser. The owner logs in there, and the app takes
over that logged-in session instead of making its own.

## What the owner does

1. Log in to the supplier in their normal browser (Chrome).
2. Use a cookie-export extension (such as Cookie-Editor) to copy the site's cookies as JSON.
3. In the app: Suppliers, then "Import login" on that supplier, paste the JSON, press Import.
4. The app saves it sealed, marks the supplier connected and runs a first check, exactly as after a live-window login.

## How it fits the app today

A saved login is a Playwright `storageState` (`cookies` and `origins`), sealed by `sealSessionState` and stored by
`supplierSessions.save`. Every check (`verify`, `capture`, `check-page`) loads that state into a fresh browser context.
So an import only has to produce the same state shape and save it. Nothing in the browser service, worker or checks changes.

```
paste JSON -> parseCookieExport (pure) -> state -> sealSessionState -> supplierSessions.save
           -> suppliers.markConnected -> resolve "needs reconnect" -> queue supplier.session.verify
```

## Goals

- Same end state as a live-window login: sealed session, connected, first check queued, notification resolved.
- Accept Cookie-Editor style JSON (an array with `name, value, domain, path, expirationDate, httpOnly, secure, sameSite`)
  and a Playwright `storageState` object. Nothing else (no cookies.txt, no HAR).
- Keep only cookies for the supplier's own site; say how many were kept and dropped.

## Non-goals and anti-goals

- No reading of the owner's browser profile or Keychain by the app. The owner copies the cookies out by hand.
- No spoofing, stealth or captcha solving (same rule as SPEC-plain-login-window.md). Importing makes no promise that the
  supplier will accept the session from our browser; the existing "Check connection" answers that.
- The live window stays. Import is a second way to connect, not a replacement.
- Cookies are credentials: never logged, audited, echoed back in an error, or kept in the browser's storage.
- This does not change the supplier's terms of use. The owner checks those (a "no automated access" clause still applies, whatever way the login was made).

## Constraints

- Public repo: no supplier names or domains in files, tests or fixtures (use `shop.example`).
- The pasted JSON reaches the API once, over the app's own session cookie and CSRF rules. Body cap 256 KB, 100 cookies kept.
- Domain filter: keep a cookie only when its domain equals the supplier's site host or is a parent or subdomain of it
  (registrable-domain match using the supplier's `websiteUrl`/`loginUrl` hosts). All other cookies are dropped, never stored.
- Cookies already expired are dropped. If nothing is left, refuse with a plain message and save nothing.

## Known risks (the owner should know before relying on it)

- Cookies set by Cloudflare or the captcha vendor (for example `cf_clearance`) are tied to the browser's user agent and
  address, so they may not work from our headless Chromium. Login cookies usually do. Only a real check can tell.
- Many login cookies are HttpOnly: a bookmarklet cannot read them. An extension is needed.
- If the supplier's sign-in lives on another domain (Shopify "new customer accounts"), cookies for that domain are dropped by
  the filter. If the check then says needs-reconnect, widen the filter in a follow-up with the owner.
- The session lasts until the supplier ends it (unknown), then the normal "needs reconnect" notice appears and the owner imports again.
- The owner's real browser session is shared with ours. Logging out in their browser may end ours.

## Approaches considered

1. **Paste cookie JSON into the app (recommended).** Smallest: one route, one pure parser, one panel. Works today.
2. Browser extension that posts cookies to the app: more convenient, but a new thing to build, ship and trust. Later, if import is used often.
3. App reads the owner's Chrome cookie file: needs Keychain access on macOS and file mounts into Docker. Rejected: invasive and fragile.

## Design

- **Pure parser** `packages/supplier-session/src/import-cookies.ts`:
  `parseCookieExport(text: string, siteHosts: string[], nowSeconds: number): { ok: true; state: SessionState; kept: number; dropped: number } | { ok: false; message: string }`.
  Maps `expirationDate` to `expires` (`-1` when absent), `sameSite` `no_restriction` to `None`, `unspecified` or missing to `Lax`, `lax` and `strict` capitalised.
  Normalises a missing `path` to `/`. `origins` is `[]` for a cookie array.
- **Route** `POST /api/suppliers/:id/session/import` (body: `{ cookies: string }`, the pasted text) in
  `apps/api/src/routes/login-sessions.ts`. 404 unknown supplier, 422 plain message when unparseable or empty.
  Shares one helper `saveConnectedSession(supplierId, state)` with `finish` (seal, save, markConnected, resolve notification, queue verify), so the
  two paths cannot drift. Audit `supplier.session_imported` with `{ kept, dropped }` only.
- **Web**: new page `ImportLoginPage` at `/suppliers/:id/import`, reached from a second button "Import login" beside Connect / Reconnect.
  Steps (3 lines), a textarea, an Import button, result message ("Saved 14 cookies, ignored 3 from other sites. Checking the connection now.").
  The textarea is cleared on success and on leave; never persisted.

## Plan (tasks, test first, one PR each, merge on green)

1. **Parser** (packages/supplier-session). Tests: Cookie-Editor array maps fields; Playwright state passes through; sameSite and missing-expiry mapping;
   other-site and expired cookies dropped and counted; garbage, empty array, all-dropped give plain errors; no error message contains a cookie value.
2. **Route + shared save helper** (apps/api). Tests (int): import saves sealed state and marks connected; queues one verify; resolves the reconnect notice;
   422 saves nothing and leaves the old session; 404; body over 256 KB refused; audit row has counts and no values; finish-login still passes unchanged.
3. **Web page + button** (apps/web). Tests: renders steps, submits text, shows kept/dropped, shows server message on 422, clears textarea;
   Suppliers row shows "Import login" for connected, needs-reconnect and not-connected suppliers; axe scan in e2e on desktop and phone.
4. **e2e + docs**: journey with the fake supplier (cookie JSON for `/account` login, then Check connection reaches ok); `docs/deployment.md` section "Importing a login from your own browser" with the extension steps.

Review focus (inputs most likely to bite): JSON with a BOM or trailing spaces; cookie `domain` with and without leading dot;
a `__Host-` cookie (no domain, needs the supplier host); `sameSite: null`; very large paste; pasting a Cookie header string
(`a=b; c=d`) instead of JSON: give a plain message saying what format is needed.

## Open questions for the owner

1. Which Chrome extension do you use or are happy to install (Cookie-Editor is my default)?
2. If the first import fails the check, may I widen the domain filter to a supplier's sign-in domain, case by case?
3. Is the button label "Import login" fine?
