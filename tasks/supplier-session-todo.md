# Tasks: supplier-session

Every task is test-first (red, green, refactor), except the spike, which is throw-away and recorded in a findings document. One branch and one PR per task, with a detailed description. Run `npm run check` before marking a task done. Run the secret scan locally before pushing.

## Task 1: Spike (decision gate)
**Description:** A throw-away proof, on the owner's machine, that the chain works: headed Chromium in Docker under Xvfb, shared by a VNC server, shown through noVNC in a page only a signed-in owner can reach (through a minimal authenticated WebSocket proxy), with a manual login saved and reused in a headless context. Uses a public test login page and a public CAPTCHA demo, never a supplier. Findings go in `docs/spikes/supplier-session.md`. Spike code lives in `spikes/supplier-session/` and is not part of the app.
**Acceptance criteria:**
- [x] Headed Chromium starts in a container built from the pinned Playwright image, and a screenshot of the virtual screen shows it
- [x] noVNC shows and controls it through an authenticated proxy: typing and clicking reach the remote page (verified by driving the noVNC page with Playwright and reading the remote page's state)
- [x] A connection without a valid token or signed-in cookie is refused
- [x] A manual-style login on a public test page is saved with `storageState` and reused in a fresh headless context to reach a page that needs login
- [x] A public CAPTCHA widget renders in the remote window (it is not solved)
- [x] Findings recorded: start time, memory use, whether the content security policy `default-src 'self'` allows the same-origin WebSocket, clipboard behaviour, how a phone behaves, and anything that surprised
- [x] The owner has tried it once and says whether typing a password felt acceptable
**Verification:** a short written report plus screenshots; the owner's try-out
**Dependencies:** None
**Files:** `spikes/supplier-session/*`, `docs/spikes/supplier-session.md`
**Scope:** Medium

### Checkpoint: after Task 1 (decision gate)
- [ ] Findings reviewed. If the chain does not work well enough, change the design (for example KasmVNC) before Task 2
- [ ] Owner approves continuing

## Task 2: Supplier validation, table and API
**Description:** `packages/supplier-session` with supplier address validation (https only, no IP addresses, no `localhost`, no look-alikes, no private, loopback, link-local or cloud-metadata addresses, with a DNS check helper). A `suppliers` table and repository, and the routes to add, list, read, edit, delete, pause and resume. Pausing records reason `owner`.
**Acceptance criteria:**
- [x] Rejects `http://`, IP addresses, `localhost`, `x.com@evil.com` tricks, ports to internal services, and names that resolve to private addresses
- [x] Supplier names are unique. Intervals have sensible limits
- [x] Pausing one supplier changes no other
- [x] All routes need a signed-in owner, and each change writes an audit event
- [x] Plain-English error messages
**Verification:** `npm run check`
**Dependencies:** 1
**Files:** `packages/supplier-session/src/validation.ts`, `packages/db/src/schema.ts`, one migration, `packages/db/src/supplier-repository.ts`, `apps/api/src/routes/suppliers.ts`, tests
**Scope:** Medium

## Task 3: Suppliers screens
**Description:** The Suppliers page (table with plain-word status badges, empty state, actions), an add and edit form, pause and resume, delete with confirmation, and the sidebar item going live. UI work: use `ui-ux-pro-max` and `design-taste-frontend`, the design system, screenshots and the accessibility scan.
**Acceptance criteria:**
- [x] "No suppliers yet. Add your first supplier." empty state
- [x] Validation messages beside each field, in plain English
- [x] Status badges use words (Not connected, Connected, Needs reconnecting, Blocked, Paused), never colour alone
- [x] Looks right at desktop and phone sizes, in light and dark, with no accessibility violations
**Verification:** `npm run check`, screenshots reviewed
**Dependencies:** 2
**Files:** `apps/web/src/pages/SuppliersPage.tsx`, `SupplierForm.tsx`, `api.ts`, `shell/AppShell.tsx`, tests
**Scope:** Medium

## Task 4: Page classifier and session sealing (pure logic)
**Description:** A pure `classifyPage` that takes what a page showed (final address, HTTP status, title, a text excerpt, whether a password field or a known challenge widget is present, the owner's login-address pattern) and returns `ok`, `login_required`, `captcha`, `blocked`, `unreachable` or `unknown`. Also functions to seal and unseal session state with the `crypto` package.
**Acceptance criteria:**
- [x] Recognises login redirects, password fields, reCAPTCHA, hCaptcha and Turnstile markers, "verify you are human" wording, HTTP 403 and 429, "access denied" wording
- [x] Says `unknown` for anything unclear, and a test proves an ambiguous page is never `ok`
- [x] Built from saved example pages (fixtures), including pages with tricky wording
- [x] Sealed state decrypts to the original, fails on tampering or a wrong key, and contains no plaintext
**Verification:** `npm run test:unit`
**Dependencies:** 1
**Files:** `packages/supplier-session/src/classify.ts`, `seal.ts`, fixtures, tests
**Scope:** Medium

## Task 5: Fake supplier website (test helper)
**Description:** A small web server for tests with: a login form, a cookie session, an account page that needs login, product pages, a switch to expire all sessions, a CAPTCHA-like page, a block page (403 and 429), a slow page, and a page that redirects to a private address. Used by every later browser test.
**Acceptance criteria:**
- [x] Logging in sets a session cookie, and the account page then loads. Expiring sessions sends the user back to the login form
- [x] The CAPTCHA-like page contains a widget marker and the wording the classifier looks for
- [x] A redirect to a private address exists so the SSRF guard can be tested
- [x] Starts and stops cleanly on a free port
**Verification:** `npm run test:unit`
**Dependencies:** None
**Files:** `packages/supplier-session/test/fake-supplier.ts`, tests
**Scope:** Small

## Task 6: Browser service, headless session check
**Description:** `services/browser`: a small control server and a Dockerfile (pinned official Playwright image, non-root user, seccomp profile). `POST /verify` takes a session state and an address, opens a throw-away headless context with the state in memory, loads the page, blocks private addresses (including after redirects), gathers the page facts and classifies them.
**Acceptance criteria:**
- [x] A saved logged-in state reaches the fake supplier's account page and returns `ok`. A fresh context returns `login_required`
- [x] Expired, CAPTCHA, blocked and slow pages return the right class, and a timeout returns `unreachable`
- [x] A redirect or link to a private, loopback or metadata address is blocked
- [x] The control server needs a control token. Wrong or missing is refused
- [x] No session state is written to disk. The response never echoes the state
**Verification:** `npm run check`; browser-service tests with real Chromium against the fake supplier
**Dependencies:** 4, 5
**Files:** `services/browser/*`, tests, CI job for browser tests
**Scope:** Medium to large

## Task 7: Browser service, interactive session
**Description:** Extend the service with Xvfb and a VNC server. `POST /sessions` opens a headed window at a supplier's login address on the virtual screen. `POST /sessions/:id/finish` captures the session state, closes the browser and deletes the profile. `DELETE /sessions/:id` cancels. Only one session at a time, a 15-minute limit, and nothing left running afterwards.
**Acceptance criteria:**
- [x] A session opens a visible window, and the VNC port answers (verified with a stand-in client)
- [x] Finishing returns the logged-in state, with the fake supplier's cookie, and closes everything
- [x] A second open session is refused with a plain error
- [x] Cancelling, finishing or timing out leaves no browser process and no profile directory
- [x] The VNC port is not published outside the container network
**Verification:** `npm run check`; browser-service tests
**Dependencies:** 1, 6
**Files:** `services/browser/*`, tests
**Scope:** Medium to large

## Task 8: Login sessions, token manager and sealed storage
**Description:** The `login_sessions`, `supplier_sessions` and (shared with Task 10) tables, the token manager (256-bit random, stored as a hash, 10 minutes, single use, constant-time comparison), and the API routes to start, read, finish and cancel a login. Finishing seals and stores the state. A client for the browser service.
**Acceptance criteria:**
- [ ] Only one open login attempt at a time, enforced by the database
- [ ] A token works once, expires after 10 minutes, and is never stored in plain form
- [ ] Finishing stores the state sealed. No route ever returns it. The raw table contains no plaintext cookie
- [ ] Cancelling, expiry and failure close the remote window and save nothing
- [ ] Starting, finishing, cancelling and failing each write an audit event without any secret
**Verification:** `npm run check`
**Dependencies:** 2, 4, 7
**Files:** `packages/db/src/schema.ts`, migration, repositories, `packages/supplier-session/src/token.ts`, `apps/api/src/routes/login-sessions.ts`, `apps/api/src/browser-client.ts`, tests
**Scope:** Large (split if needed)

## Task 9: The live-window WebSocket proxy and its security tests
**Description:** The WebSocket route that, after the one-time-token handshake, pipes bytes between the owner's page and the browser service's VNC port. Refuses anything not signed in, from the wrong origin, or with a bad token. Rate limited. Passes bytes without logging them.
**Acceptance criteria:**
- [ ] Refused: no session cookie, wrong or missing `Origin`, missing, wrong, expired or reused token. Each refusal writes an audit event and reaches nothing behind the proxy
- [ ] A correct connection pipes data both ways (against a stand-in VNC server), and closes when either side closes
- [ ] The token is read from the first message, never from the address
- [ ] Repeated failures are rate limited
- [ ] No byte of traffic appears in logs or audit events
- [ ] The content security policy allows only what the window needs
**Verification:** `npm run check`
**Dependencies:** 8
**Files:** `apps/api/src/routes/login-screen.ts`, tests
**Scope:** Medium

### Checkpoint: after Task 9 (security)
- [ ] `npm run check` passes
- [ ] A review of every way into the browser service: no published port, owner-only proxy, one-time token
- [ ] Review with owner before continuing

## Task 10: Session check job, statuses, pauses and notifications
**Description:** The `notifications` table. A `supplier.session.verify` job (empty payload) and API route that decrypt the saved state, ask the browser service to verify it, and update the supplier. `login_required`, `captcha` and `blocked` set the status, pause that supplier with reason `session`, and create exactly one open notification. `unreachable` is retried before anything is declared broken. `unknown` needs attention.
**Acceptance criteria:**
- [ ] Each result sets the right `session_status` and only that supplier is paused
- [ ] Repeated failures create one notification, not many
- [ ] A successful reconnect lifts a `session` pause and resolves the notification. An `owner` pause stays paused
- [ ] `unreachable` is retried and does not by itself mark the session broken
- [ ] A failed or blocked check is never reported as stock information
- [ ] No state, cookie or token appears in the job, logs or audit events
**Verification:** `npm run check`
**Dependencies:** 2, 4, 6, 8
**Files:** schema and migration, `packages/queue/src/jobs.ts`, `apps/worker/src/supplier-verify.ts`, `apps/api/src/routes/notifications.ts`, tests
**Scope:** Medium to large

## Task 11: Connect screen and dashboard card
**Description:** The Connect screen (the noVNC library in the page, our own WebSocket handshake first, instructions, a countdown, **I'm logged in**, **Cancel**, a "Paste text" box, plain errors), the **Reconnect supplier** action on the Suppliers page, and a "Needs attention" card on the Dashboard fed by notifications. UI work with the design system, screenshots and the accessibility scan.
**Acceptance criteria:**
- [ ] The window appears only after the handshake succeeds. A failed handshake shows a plain message and no window
- [ ] The token is sent as the first message, never in the address
- [ ] Cancelling, closing the page, or running out of time closes the remote window
- [ ] The Dashboard card lists open notifications with a working **Reconnect supplier** button. Empty state when none
- [ ] Keyboard and screen reader friendly around the live window, and no accessibility violations
- [ ] Works at desktop size. Phone is usable for status and notifications, and the connect screen says it is best on a computer
**Verification:** `npm run check`, screenshots reviewed
**Dependencies:** 3, 9, 10
**Files:** `apps/web/src/pages/ConnectSupplierPage.tsx`, `components/LiveWindow.tsx`, `pages/DashboardPage.tsx`, `api.ts`, tests
**Scope:** Large (split if needed)

## Task 12: Docker Compose integration
**Description:** Add the browser service to `docker-compose.yml` on a private network shared only with the API and worker, with no published ports, a non-root user, a seccomp profile, resource limits and the control token. A test reads the compose file and inspects the running container.
**Acceptance criteria:**
- [ ] `docker compose up` starts everything and the API can reach the browser service
- [ ] The browser service publishes no ports and is not on the default network
- [ ] It runs as a non-root user, has no database credentials or encryption key in its environment, and mounts no host folders
- [ ] The CI image check loads the browser service too
- [ ] `docs/deployment.md` explains the new service and its security posture
**Verification:** the compose test; a manual `docker compose up` smoke test in an isolated project
**Dependencies:** 7, 9
**Files:** `docker-compose.yml`, `services/browser/Dockerfile`, `.env.example`, `docs/deployment.md`, tests
**Scope:** Medium

## Task 13: Browser tests through the whole stack
**Description:** Extend the stack launcher with the browser service and the fake supplier. Drive the journeys in a real browser: add a supplier, connect it (with a test-only hook that logs in inside the remote window), see it connected, expire the session, see the notification and the pause, reconnect, and see it resume.
**Acceptance criteria:**
- [ ] Journeys: add and edit a supplier, connect, expired session, CAPTCHA, block, reconnect and resume, owner pause stays paused, cancel leaves nothing running
- [ ] A refused screen connection is shown to the owner plainly
- [ ] No secret in any page, response, console message or storage
- [ ] Accessibility scan in light and dark of the new screens
- [ ] Runs in CI at desktop and phone sizes
**Verification:** `npm run test:e2e`
**Dependencies:** 11, 12
**Files:** `e2e/stack.ts`, `e2e/supplier-session.spec.ts`, helpers
**Scope:** Medium to large

### Checkpoint: after Task 13
- [ ] `npm run check` and `npm run test:e2e` pass in CI
- [ ] Review with owner before connecting a real supplier

## Task 14: Pilot supplier, with the owner
**Description:** With the owner at the keyboard, connect the real pilot supplier through the live window, run a session check, and record what happened. Add the supplier's real login behaviour to the classifier fixtures (with any private details removed). Write the owner's setup guide.
**Acceptance criteria:**
- [ ] The owner has checked the supplier's terms on automated access
- [ ] The owner logs in by hand through the live window and the session is saved
- [ ] A session check from a fresh headless context reaches a page that needs login, or the app says plainly why it did not
- [ ] What the supplier showed (CAPTCHA, code, redirects, how long the session lasted) is recorded
- [ ] Anything the classifier got wrong is fixed with a test
- [ ] `docs/deployment.md` has a step-by-step guide for connecting a supplier
**Verification:** manual run, recorded in the PR with private details hidden
**Dependencies:** 13, and the owner naming the pilot supplier
**Files:** `docs/deployment.md`, fixtures and tests as needed
**Scope:** Small to medium

### Checkpoint: module complete
- [ ] All eleven success criteria in `SPEC-supplier-session.md` met
- [ ] Owner has connected the pilot supplier by hand
- [ ] Review with owner, then write `SPEC-mapping.md`
