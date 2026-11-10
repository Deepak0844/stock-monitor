# Spike findings: supplier-session live window

Run on 2026-11-08 on the owner's Mac (Docker Desktop, 7.8 GiB). Code: `spikes/supplier-session/` (throw-away, not part of the app). Driver: `drive.mjs`, which plays the owner in a real Chromium. Public targets only: a local fake login site, and Google's public reCAPTCHA demo page (looked at, never solved). No supplier was visited.

**Result: 21 of 21 automated checks pass (rerun at the end after the page changes). The chain works. Nothing found that needs a design change (KasmVNC not needed).** The owner has also tried it (see the end).

## Setup

Three containers in an isolated Compose project `spike`: `site` (fake supplier), `browser` (pinned Playwright image, Xvfb 1280x800, x11vnc, a small control server, headed Chromium, non-root), `proxy` (owner-only gate and WebSocket proxy, serves the noVNC page). Only the proxy publishes a port (127.0.0.1 only). The browser container publishes none.

## Findings against the acceptance criteria

| Question | Answer |
|---|---|
| Headed Chromium in the pinned Playwright image? | Yes. Chromium 158.0.8127.18, runs as uid 1001 (non-root). **Correction (found in Task 6): the sandbox was NOT on.** The spike only checked its own flags, but Playwright's default `chromiumSandbox: false` adds `--no-sandbox` by itself. Screenshot: `supplier-session/01-connected.png`. |
| Start time | About 0.5 s from the start request to a visible window (image already built and container already running). A cold container start was not timed. |
| Memory | About 900 MB for the browser container while a window was open and a page loaded (reCAPTCHA page). About 48 MB idle with no Chromium running. The proxy uses about 45 MB. Plan for 1 GB per live window; the later headless checks need their own budget. |
| Image size | `spike-browser` 2.62 GB, the proxy and site about 250 MB each. |
| Typing and clicking through noVNC | Real keystrokes sent to the noVNC canvas reach the remote page and a login through the window works. |
| Auth refusals | Refused: no owner cookie (page, start request, WebSocket), wrong Origin with a valid cookie, wrong token, a reused token. A second session while one is open is refused (HTTP 502 from the proxy; the real service should return a plain 409). |
| Saved login reused | The session state from `finish` has the cookie (2 cookies). A fresh headless context given that state reaches the logged-in page. Without the state it is sent to the login page. After the site expires sessions the saved state is sent to the login page too, so expiry is detectable. |
| CAPTCHA widget | The reCAPTCHA widget renders in the remote window: `supplier-session/03-captcha-widget.png`. Not solved. |
| CSP `default-src 'self'` and a same-origin WebSocket | **Allowed.** No CSP violation was logged. In modern Chromium `'self'` covers same-origin `ws://` and `wss://`, so no CSP loosening is needed. |
| Clipboard | Works through noVNC (`clipboardPasteFrom`) into x11vnc, which sets both the PRIMARY and CLIPBOARD selections, and `Ctrl+V` in the remote page pastes it. **Gotcha:** my first driver sent `Control+V` (capital V), which is Ctrl+Shift+V, and nothing pasted. `Control+v` works. **Correction:** this is not only a test detail. The owner pressed Ctrl+V in the live window and nothing pasted, because the noVNC library never reads the owner's own clipboard. The owner's text must be sent explicitly with `clipboardPasteFrom`, which is why the spec has a "Paste text" box. The spike page now has one; result below. |
| Phone | The window connects and the page does not scroll sideways, but the remote screen is a fixed 1280x800 shrunk to the phone's width, so text is tiny: `supplier-session/04-phone.png`. Usable to look at, poor for typing or a CAPTCHA. This confirms the spec: desktop is the supported way to connect, a phone is best effort. A later option is to resize the virtual screen to the client's size. |

## Surprises

1. **Port 4190 is blocked by Node's `fetch`** (it is on the browser "bad ports" list, ManageSieve) and gave `TypeError: fetch failed: bad port`. The spike moved the host port to 4191. **Do not use 4190 (or other fetch-blocked ports) for anything a browser or Node client calls.** The app's API stays on 3000.
2. x11vnc logs keysym warnings at start and `Xlib: extension "DPMS" missing`. Harmless. Its `-debug_sel` option logs clipboard text, so it must never be enabled outside debugging. The spike uses `-quiet`.
3. x11vnc runs with no password because the port is reachable only from the proxy over the private network. The real design must keep it that way (task 12 checks it).

## What the spike did not cover

- A real supplier, a real CAPTCHA solve, or MFA. Those need the owner and are for task 14.
- Cold start time, running for the full 15 minutes, or two clients at once.
- The sandbox. **Wrong in the first version of this note.** With `chromiumSandbox: true`, Chromium as a non-root user fails with "No usable sandbox" under Docker's default seccomp profile, because that profile blocks user namespaces. Playwright's own `seccomp_profile.json` (kept unchanged in `services/browser/`) fixes it. Task 6 runs the service with the sandbox on and that profile, and checked that no Chromium process carries `--no-sandbox`. Every container that runs Chromium (the live window in Task 7 too) needs `chromiumSandbox: true` and that profile.
- Typing feel over a slow link.

## Owner try-out

The owner opened the live window in their desktop browser and logged into the fake site by typing the username and password: it worked and they saw "You're logged in". Verdict on typing: **"no lags"**, so acceptable.

Paste took three attempts and showed two things that matter for the real build:

1. Pressing Ctrl+V with nothing sent first does nothing (see the clipboard row above). The "Paste text" box fixed it: type or paste the text into the box, click **Send to remote clipboard**, click inside the remote field, press Ctrl+V. This worked for the owner.
2. **Each tab that loads the page starts its own browser session, and a second one is refused with `502`** while one is open. The owner hit this after reloading and saw `start-refused-502`. The real design needs: a plain message ("A login window is already open"), a way to resume or close the open one, and cleanup when a tab closes (the spec already requires this).
3. `docker restart` of the browser container left a stale X lock, so Chromium could not launch and every start failed with `browserType.launch: Target page, context or browser has been closed`. Recreating the container fixed it. The real service should remove stale `/tmp/.X99-lock` files at start, or the container must always be recreated.
4. The proxy crashed once when a start request arrived before the browser service was listening (an unhandled rejection). The spike now guards it. The real proxy must return a plain error instead.

## Owner try-out on the real stack (2026-11-08, after Task 12)

The owner added an ordinary public website as a supplier on their own Docker Compose stack (the real browser container on its private network, the real proxy and the real viewer) and pressed Connect. Their words:

- **Typing:** no issues.
- **Paste:** works (Paste text, Send to the window, then Ctrl+V).
- **The page:** the website they gave rendered.
- **Anything odd:** nothing.

This confirms on the real container what the first try-out showed on the spike, and that the locked-down container (read-only filesystem, one capability, seccomp profile, no host folders) does not get in the way of a live window. It was not a real supplier, so a real CAPTCHA, a code or a long login is still untested. That is the pilot supplier's job (Task 14).

## The pilot supplier rejected the puzzle in the live window (2026-11-09)

The owner tried the pilot supplier (a Shopify storefront) in the live window. They solved Google's puzzle and the storefront answered "Captcha failed". The same login and puzzle worked in their normal browser at the same moment on the same internet connection. From inside the container, name lookup and connections to the puzzle's servers were fine, so the network path was ruled out. (The puzzle's `recaptcha.net` address lists an unreachable IPv6 address second; the proxy tries only the first address it resolves, which is a small thing worth hardening later.)

What we found out while building the plain window (`SPEC-plain-login-window.md`):

- Chromium reports `navigator.webdriver = true` to every page as soon as **any** remote-control channel is open on it, whether or not the tool is using it. Without one, it reports `false`. The fake supplier's `/webdriver-report` page shows this: `/seen/true` from the controlled window and `/seen/false` from the plain one.
- So the plain window cannot keep a control channel open, even one that is only used at the end. The design therefore changed: when the owner finishes, the browser is told to shut down gracefully (SIGINT) and its cookie file is read offline. On Linux, Chromium encrypts cookie values with a key derived from a fixed password when it runs with `--password-store=basic`, which the service uses, so no key store is involved.
- **SIGINT, not SIGTERM.** SIGTERM ended the browser without writing its cookies. SIGINT made it shut down gracefully and write them, including cookies with no expiry (kept because the profile is seeded with "continue where you left off").
- A plain Chromium turns the guard's empty refusal into its own error page, so a typed private address fails to load with `ERR_HTTP_RESPONSE_CODE_FAILURE` and the internal server receives nothing.
- Tested on Linux and inside the real container: ordinary command line (no remote-debugging, automation or `--no-sandbox` switch), sandbox on, window drawn on the shared screen, `/seen/false`, empty session when nothing was logged in, no process and no profile left after finish, cancel, time-out or the owner closing the window.

**Not yet known:** whether the pilot supplier accepts its puzzle in the plain window. That is the owner's try-out (set `LOGIN_WINDOW_MODE=plain`, recreate the browser container, press Connect). If it still fails, the experiment has answered the question and the other options in the spec stand.
