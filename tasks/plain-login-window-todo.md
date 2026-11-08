# Tasks: plain login window

Spec: `SPEC-plain-login-window.md`. Every task is test-first. Run `npm run check` (and `npm run test:browser`, `npm run test:container` where the task says) before marking it done.

## Task 1: Setting and plumbing
**Description:** A `LOGIN_WINDOW_MODE` setting (`controlled` by default, or `plain`) read by the browser service and passed to its container by Compose, and a way for the service to choose which window opener to use. No behaviour change in `controlled`.
**Acceptance criteria:**
- [x] Unknown values stop the service from starting, with a plain message naming the setting
- [x] Compose passes `LOGIN_WINDOW_MODE` (default `controlled`) to the browser container, and `.env.example` explains it
- [x] `controlled` behaves exactly as before
**Verification:** `npm run check`; the Compose tests
**Files:** `services/browser/src/config.ts`, `service.ts`, `main.ts`, `docker-compose.yml`, `.env.example`, tests

## Task 2: A guard listener for one plain window
**Description:** The guard proxy can open a second, loopback-only listener with no password for a single window (a plain Chromium cannot supply the per-check proxy login). It uses the same guard and counts, and is closed when the window ends.
**Acceptance criteria:**
- [x] Refuses private, loopback and metadata addresses exactly as the main listener does
- [x] Listens on 127.0.0.1 only, and stops listening when closed
- [x] The main listener still needs its password
**Verification:** `npm run check`
**Files:** `services/browser/src/proxy.ts`, tests

## Task 3: The plain window
**Description:** `plain-window.ts` starts the Chromium binary directly with ordinary flags and the sandbox on, in a temporary profile seeded so passwords, autofill and sign-in are off, behind the loopback guard listener. Nothing controls it: no debugging channel is open. At finish the browser is shut down gracefully (SIGINT) and the session is read from its cookie file; the profile is deleted however the window ends.
**Acceptance criteria:**
- [x] Types a login, finish returns the session, and a fresh headless check reaches the account page
- [x] The page sees `navigator.webdriver` as false in plain mode (and true in controlled mode), reported by the fake supplier with nothing attached to the browser
- [x] Redirects and typed addresses to private networks and loopback are refused
- [x] A typed password is in no file in the profile, and the profile is gone after finish, cancel, time-out and the owner closing the window
- [x] No Chromium process is left behind
**Verification:** `npm run test:browser`
**Files:** `services/browser/src/plain-window.ts`, `service.ts`, fake supplier test helper, tests

## Task 4: Hardened container check and owner try-out
**Description:** The same checks inside the locked-down image with `plain` on (sandbox verified on, no automation switch in any process's command line, one window at a time), the deployment notes, and the owner's try-out on the real supplier in each mode.
**Acceptance criteria:**
- [x] The container tests pass in both modes, including the Compose project
- [x] `docs/deployment.md` and `docs/spikes/supplier-session.md` record what to set and what was seen
- [ ] The owner has tried the real supplier in `plain` mode and said what happened
**Verification:** `npm run test:container`; the owner's try-out
**Files:** container and Compose tests, docs
