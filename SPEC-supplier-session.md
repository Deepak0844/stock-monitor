# Spec: supplier-session

Module id: `supplier-session`. Depends on: `foundation` (done). Map: `CAPABILITY-MAP.md`. Intent: `docs/intent/stock-monitor.md`.

Status: **draft for owner review.** Not approved.

## Objective

Let the owner add suppliers and connect each one by logging in **by hand**, solving any CAPTCHA or MFA, in a real browser window that runs on the server and is shown inside the owner's own browser tab. The app then saves that logged-in session, encrypted and isolated per supplier, so later modules can check stock without the owner. The app notices when a session expires or a supplier shows a CAPTCHA or block, pauses that supplier, tells the owner, and offers a clear **Reconnect supplier** action. It never bypasses a CAPTCHA and never assumes a saved session will prevent future challenges.

User: the store owner. Success: the owner adds the pilot supplier, connects it through the live window, and the app can later prove the saved session still works, or say plainly that it does not.

## What the research found (official documentation, read 2026-11-08)

**Playwright** ([auth](https://playwright.dev/docs/auth), [BrowserContext](https://playwright.dev/docs/api/class-browsercontext), [BrowserType](https://playwright.dev/docs/api/class-browsertype), [Docker](https://playwright.dev/docs/docker)):
- `storageState()` returns cookies and local storage, and IndexedDB only if asked for. **Session storage is not included**, and Playwright offers no API to persist it. A site that keeps its login only in session storage cannot be reused this way.
- The saved state "may contain sensitive cookies and headers that could be used to impersonate you". So we never write it to a file. We keep it encrypted in the database and pass it to a new browser context **in memory** (the `storageState` option accepts an object).
- `launchPersistentContext` keeps a profile directory on disk, and a directory cannot be shared by two browsers at once. We avoid it: each use is a fresh, throw-away context.
- Playwright does not detect expiry or login pages for us: "you need to delete the stored state when it expires". Detection is our own code.
- The official Docker image is `mcr.microsoft.com/playwright:v<version>-noble`, to be pinned to the same Playwright version. Recommended flags: `--init` and `--ipc=host`. It runs as root by default, which disables Chromium's sandbox. For crawling it recommends a separate non-root user and a seccomp profile. **It states the image "is intended to be used for testing and development purposes only" and is "not recommended to visit untrusted websites".**
- **Not stated anywhere I read:** running a visible (non-headless) browser in Docker, Xvfb, detecting login pages, CAPTCHA or MFA. These are covered by the spike below.

**noVNC** ([README](https://github.com/novnc/noVNC), [API](https://github.com/novnc/noVNC/blob/master/docs/API.md), [embedding](https://github.com/novnc/noVNC/blob/master/docs/EMBEDDING.md), [websockify](https://github.com/novnc/websockify)):
- noVNC is a JavaScript library (`RFB`) and an app. **`new RFB(target, urlOrChannel)` accepts an already-open WebSocket**, so we can run our own handshake first.
- noVNC has no authentication of its own beyond the VNC password. The pages give no advice on exposing it publicly, and the websockify token feature is barely documented (token format, expiry and single use are not stated). **So authentication will be our code, not theirs.**
- It supports touch gestures and text clipboard (`clipboardPasteFrom`, a `clipboard` event), and runs on mobile browsers.
- **KasmVNC** is the alternative: a browser-only client with built-in TLS, user authentication, a brute-force blocklist, clipboard and better mobile support. It breaks from the standard VNC protocol and is a larger dependency whose security we would not control. Its docs were not read in detail. It stays a fallback if noVNC proves awkward.

## Architecture

```
Owner's browser ──HTTPS──> API ──private network──> Browser service (isolated container)
   (noVNC in the page)     │  checks the owner is signed in,        Chromium + Xvfb + VNC server
                           │  checks a one-time token,              no database, no secrets
                           │  then pipes WebSocket bytes            runs as a non-root user
                           └──> queue ──> Worker ──private network──> Browser service (headless checks, later modules)
```

- **One isolated browser service.** All browser activity, interactive logins and later headless checks, happens in this container. It has **no database access and no encryption key**. The supplier's website is the least-trusted thing in the system, so it runs where the worst it can reach is the browser itself.
- **How the live window works on a remote server.** Chromium runs on the server inside a virtual screen. A VNC server shares that screen. The API proxies it over a WebSocket to the noVNC client in the owner's page. The owner sees and controls the real browser, including typing a password and clicking a CAPTCHA. **The supplier sees the server's IP address, not the owner's.** That has a good side (a session tied to an IP keeps working when the automated checks later run from the same place) and a bad side (some suppliers distrust datacenter addresses and show more CAPTCHAs or blocks).
- **Nothing VNC-related is exposed.** The browser service publishes no ports. Only the API can reach it, over a private Docker network.
- **The saved session never touches disk in plain form.** The browser service returns the session state to the API at the end of a login. The API encrypts it (AES-256-GCM, the existing `crypto` package) and stores it in PostgreSQL. For a check, the API or worker decrypts it and sends it to the browser service in the request, where it lives in memory for that one context.
- **One login session at a time** (one virtual screen). A single owner does not need more.

## Assumptions (correct me now)

1. The owner connects each supplier by logging in manually. The app never stores a supplier password and never automates a login.
2. One saved session per supplier, isolated from every other supplier's.
3. Desktop is the main way to connect a supplier. A phone is best effort, because solving a CAPTCHA through a remote screen on a small touch display is hard. The saved session then works for scheduled checks from anywhere.
4. Notifications are in the dashboard only (earlier decision).
5. Suppliers are reached over HTTPS only, and never at private or internal addresses.
6. The pilot runs on the owner's Mac with Docker, or on one small VPS. Both work the same way. They differ in the IP address the supplier sees.
7. Playwright and Chromium stay pinned to one version, updated deliberately.

## Data model

| Table | Purpose |
|---|---|
| `suppliers` | Name (unique), website address, optional login address, check interval (minutes), `enabled`, `session_status`, `paused_reason`, last session check time, created and updated times |
| `supplier_sessions` | One row per supplier: the **encrypted** session state (ciphertext, iv, tag, key id), saved-at time, last verified time, and non-secret facts (which sites it covers, size). Never readable by the screens. |
| `login_sessions` | One interactive login attempt: supplier, hashed one-time token, status (`starting`, `ready`, `connected`, `saving`, `finished`, `cancelled`, `expired`, `failed`), who started it, created, expires (10 minutes), used. A partial unique index allows only one open attempt. |
| `notifications` | A message for the dashboard: kind (for example `supplier_needs_reconnect`), supplier, plain-English text, created, read and resolved times. One open notification per kind and supplier. |

`session_status` is one of: `not_connected`, `connected`, `needs_reconnect`, `blocked`. `paused_reason` is `owner` (the owner paused it) or `session` (the app paused it because the session needs attention). Only a `session` pause is lifted automatically after a successful reconnect. An `owner` pause never is.

## Behaviour

1. **Suppliers.** Add, edit, enable and disable. Pausing one never affects another. The website address must be `https`, must not be an IP address or `localhost`, and must not resolve to a private address.
2. **Connect a supplier** (the guided flow):
   1. The owner presses **Connect**. The API creates a login attempt and a one-time token (256 bits, stored only as a hash, valid 10 minutes, single use) and asks the browser service to open a fresh Chromium window at the supplier's login address.
   2. The page shows the live window (noVNC). Before any picture is sent, the page opens a WebSocket to the API and sends the token as its first message. The API checks the signed-in owner, the page's origin and the token, marks the token used, and only then starts piping bytes.
   3. The owner logs in by hand, solves any CAPTCHA or MFA, then presses **I'm logged in**.
   4. The browser service captures the session state and closes the browser. The API encrypts and saves it, runs a first session check, sets the supplier to `connected`, and lifts a `session` pause.
   5. **Cancel**, closing the page, or 15 minutes pass: the browser is closed and the profile deleted. Nothing is saved.
3. **Session check.** Opens a throw-away headless context with the saved state, loads the supplier page, and classifies what it sees (below). It runs after connecting, from "Check connection", and on a schedule once `scheduling` exists.
4. **What the checker recognises** (a pure function over what the page showed, tested on saved real pages):
   - `ok`: no sign of a problem.
   - `login_required`: redirected to a login page, a password field is showing, or the owner's configured login-address pattern matches.
   - `captcha`: a known challenge widget (reCAPTCHA, hCaptcha, Turnstile) or phrases such as "verify you are human".
   - `blocked`: HTTP 403 or 429, or phrases such as "access denied".
   - `unreachable`: network failure or a timeout.
   - **When unsure, it says so (`unknown`) and treats it as needing attention.** It never calls an unclear page `ok`, and a failed or blocked check is never read as "out of stock".
5. **When a session needs attention** (`login_required`, `captcha` or `blocked`): set the status, pause that supplier's checks with reason `session`, create **one** dashboard notification in plain English ("Acme needs you to log in again"), and show **Reconnect supplier**. A temporary failure (`unreachable`) is retried before anything is declared broken.
6. **Reconnect** is the same flow as Connect. On success the supplier resumes and the notification is marked resolved.
7. **Disconnect and delete.** The owner can remove a saved session, which deletes the stored state, or delete a supplier.
8. **Never:** solve or bypass a CAPTCHA, store a supplier password, log keystrokes, or assume a saved session will not be challenged again.

## Security

- **Authentication is ours.** The live-window WebSocket needs: a valid owner session cookie, an allowed `Origin` (so another website cannot drive it with the owner's cookie), and a valid one-time token. Wrong, expired or reused tokens are refused and audited. Attempts are rate limited.
- **Nothing is logged from the screen.** The proxy passes bytes through. It does not log, store or inspect keystrokes, clipboard contents or pictures.
- **The browser container is locked down:** no published ports, a private network shared only with the API and worker, a non-root user, a seccomp profile, a memory and CPU limit, no mounted host folders, a throw-away profile in memory, and **no database credentials or encryption key**. A control token authenticates the API to it.
- **SSRF guard.** Requests to loopback, private, link-local and cloud-metadata addresses are blocked inside the browser service, including after redirects and DNS lookups, as a second line of defence behind its separate network.
- **Secrets:** saved state is encrypted with the existing key. The screens and logs never receive it. Audit events record who connected which supplier and when, never contents.
- **Headers:** the content security policy is extended only as far as the live window needs (a same-origin WebSocket), and is re-checked in the browser tests.
- **Known limits:** anyone who gains control of the server could use saved sessions (the earlier "server hardening" point still applies). The supplier's page runs in a real Chromium, so Chromium bugs matter: the version is pinned and updated deliberately, and the container isolation is the backstop.

## Interface (API routes, all need a signed-in owner)

`GET/POST /api/suppliers`, `GET/PATCH/DELETE /api/suppliers/:id`, `POST /api/suppliers/:id/pause` and `/resume`, `POST /api/suppliers/:id/login-session` (start), `GET /api/login-sessions/:id`, `POST /api/login-sessions/:id/finish` and `/cancel`, **WebSocket** `/api/login-sessions/:id/screen`, `POST /api/suppliers/:id/check-session`, `DELETE /api/suppliers/:id/session`, `GET /api/notifications`, `POST /api/notifications/:id/read`.

Browser service (private network only): `POST /sessions` (open a window), `POST /sessions/:id/finish` (return state and close), `DELETE /sessions/:id`, `POST /verify` (classify a page using a given state), plus the screen's VNC port, reachable only from the API.

## Screens

- **Suppliers:** a table with name, website, a status badge written in words (Not connected, Connected, Needs reconnecting, Blocked, Paused), last checked, and actions. Empty state: "No suppliers yet. Add your first supplier."
- **Add or edit supplier:** name, website, optional login address, check interval, with plain-English validation.
- **Connect supplier:** the live window with a short instruction ("Log in as you normally would. Solve any puzzle or code. Then press I'm logged in."), a countdown, **I'm logged in** and **Cancel**, and a clear message if the window cannot start. A small "Paste text" box uses noVNC's clipboard so a password from a password manager can be pasted.
- **Dashboard:** a "Needs attention" card listing open notifications with a **Reconnect supplier** button.
- The sidebar's Suppliers item becomes live.

## Project structure

```
packages/supplier-session/   token manager, page classifier, session-state sealing, supplier validation (no browser code)
services/browser/            the isolated container: control server, Xvfb, VNC, Playwright (its own Dockerfile)
packages/db/                 new tables and repositories
apps/api/src/routes/         suppliers, login sessions, the WebSocket proxy, notifications
apps/web/src/                Suppliers pages, the connect screen (noVNC), dashboard card
e2e/                         a fake supplier website for the tests
```

## Commands

`npm run check`, `npm run test:e2e`, plus `docker compose up` (the browser service joins the stack on a private network). The browser image is built from the official Playwright image pinned to the exact Playwright version.

## Testing strategy

All work test-first.
- **Unit:** the classifier on saved real-page fixtures (login, CAPTCHA, block, normal, ambiguous); the token manager (single use, expiry, hashing, constant-time compare); state sealing and unsealing; supplier address validation (https only, no IPs, no private ranges, no look-alikes).
- **Integration (real PostgreSQL):** supplier rules, one open login attempt at a time, one open notification per supplier, a `session` pause lifted on reconnect and an `owner` pause not, and the sealed state never readable through any route.
- **Proxy security tests:** no cookie, wrong origin, missing, wrong, expired or reused token are all refused and none reaches the browser service. A good one pipes bytes both ways (against a stand-in VNC server).
- **A fake supplier website** (in the test helpers) with a login form, a cookie session that can be made to expire, a CAPTCHA-like page, a block page and a product page. Browser-service tests run real Chromium against it.
- **End to end:** the connect flow in a real browser. A test-only hook lets the test log in inside the remote window, because driving a remote canvas by hand is impractical. **Real human interaction (typing, a real CAPTCHA, a real supplier) cannot be automated and is verified by the owner in the spike and the pilot.**
- No test visits a real supplier.

## Spike (first task, before building on the design)

A short, throw-away proof, run on the owner's machine, that this works end to end: a headed Chromium in Docker under Xvfb, shared by VNC, shown through noVNC inside a page that only the signed-in owner can reach, with a manual login saved and reused in a headless context. Run against a public test login page and a public CAPTCHA demo, **not a supplier**. It answers what the documentation does not (headed Chromium in the Playwright image, the content-security-policy behaviour of a same-origin WebSocket, typing and clipboard behaviour, and how it feels on a phone) before any real code depends on it.

## Boundaries

- **Always:** keep suppliers isolated from each other, encrypt saved state, check owner, origin and token on every screen connection, audit connects and failures, use a fake supplier in tests.
- **Ask first:** visiting any real supplier site, adding a dependency, changing the container's permissions, loosening the content-security-policy, exposing any new port.
- **Never:** bypass or auto-solve a CAPTCHA, store a supplier password, log keystrokes or screen contents, write session state to disk in plain form, publish the browser service's ports, give the browser container database access or the encryption key, treat a failed check as "out of stock".

## Success criteria

1. A supplier can be added, edited, paused, resumed and deleted. Invalid addresses (http, IPs, localhost, private ranges) are refused with plain messages.
2. The connect flow opens a live window, the owner logs in, and the session is saved encrypted. Cancelling or timing out saves nothing and leaves no browser running.
3. A saved session is reused in a fresh headless context and reaches a page that needs login on the fake supplier.
4. The screen connection is refused without a signed-in owner, with a wrong origin, and with a missing, wrong, expired or reused token, and each refusal is audited.
5. When the fake supplier expires the session, shows a CAPTCHA or blocks, the app sets the right status, pauses only that supplier, and creates exactly one dashboard notification with **Reconnect supplier**.
6. Reconnecting resumes a `session` pause and resolves the notification. An `owner` pause stays paused.
7. An unclear page is reported as `unknown` and needs attention, never as `ok`.
8. The browser service has no published ports, runs as a non-root user, and holds no database credentials or encryption key. This is checked by a test of the compose file and the container.
9. No session state, cookie, password or token appears in any API response, log, audit event or queued job.
10. `npm run check` and the browser tests pass, including the accessibility scan of the new screens.
11. **The spike is done and its findings are recorded**, and the owner has connected the pilot supplier by hand through the live window.

## Open Questions for the owner

1. **Which supplier is the pilot?** Its name, website and login address. Does it use a CAPTCHA, a text-message or app code, or neither? Roughly how long does a login last before it asks again?
2. **Where will the pilot run?** On your Mac (the supplier sees your home internet address) or on a small server (a datacentre address, which some suppliers dislike)? Either works. I'd start on your Mac for the pilot.
3. **Have you checked the supplier's terms** about automated access? The app only ever uses a session you created, and checks gently, but the terms decide whether it is allowed.
4. **Are you comfortable connecting suppliers from a desktop browser?** A phone is best effort for CAPTCHAs.
5. **One account per supplier, shared by everyone?** Or does the supplier tie a login to a person or a device?
