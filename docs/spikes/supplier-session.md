# Spike findings: supplier-session live window

Run on 2026-11-08 on the owner's Mac (Docker Desktop, 7.8 GiB). Code: `spikes/supplier-session/` (throw-away, not part of the app). Driver: `drive.mjs`, which plays the owner in a real Chromium. Public targets only: a local fake login site, and Google's public reCAPTCHA demo page (looked at, never solved). No supplier was visited.

**Result: 21 of 21 automated checks pass. The chain works. Nothing found that needs a design change (KasmVNC not needed).** Still open: the owner's own try-out (see the end).

## Setup

Three containers in an isolated Compose project `spike`: `site` (fake supplier), `browser` (pinned Playwright image, Xvfb 1280x800, x11vnc, a small control server, headed Chromium, non-root), `proxy` (owner-only gate and WebSocket proxy, serves the noVNC page). Only the proxy publishes a port (127.0.0.1 only). The browser container publishes none.

## Findings against the acceptance criteria

| Question | Answer |
|---|---|
| Headed Chromium in the pinned Playwright image? | Yes. Chromium 158.0.8127.18, runs as uid 1001 (non-root) **with Chromium's sandbox on** (no `--no-sandbox` needed). Screenshot: `supplier-session/01-connected.png`. |
| Start time | About 0.5 s from the start request to a visible window (image already built and container already running). A cold container start was not timed. |
| Memory | About 900 MB for the browser container while a window was open and a page loaded (reCAPTCHA page). About 48 MB idle with no Chromium running. The proxy uses about 45 MB. Plan for 1 GB per live window; the later headless checks need their own budget. |
| Image size | `spike-browser` 2.62 GB, the proxy and site about 250 MB each. |
| Typing and clicking through noVNC | Real keystrokes sent to the noVNC canvas reach the remote page and a login through the window works. |
| Auth refusals | Refused: no owner cookie (page, start request, WebSocket), wrong Origin with a valid cookie, wrong token, a reused token. A second session while one is open is refused (HTTP 502 from the proxy; the real service should return a plain 409). |
| Saved login reused | The session state from `finish` has the cookie (2 cookies). A fresh headless context given that state reaches the logged-in page. Without the state it is sent to the login page. After the site expires sessions the saved state is sent to the login page too, so expiry is detectable. |
| CAPTCHA widget | The reCAPTCHA widget renders in the remote window: `supplier-session/03-captcha-widget.png`. Not solved. |
| CSP `default-src 'self'` and a same-origin WebSocket | **Allowed.** No CSP violation was logged. In modern Chromium `'self'` covers same-origin `ws://` and `wss://`, so no CSP loosening is needed. |
| Clipboard | Works through noVNC (`clipboardPasteFrom`) into x11vnc, which sets both the PRIMARY and CLIPBOARD selections, and `Ctrl+V` in the remote page pastes it. **Gotcha:** my first driver sent `Control+V` (capital V), which is Ctrl+Shift+V, and nothing pasted. `Control+v` works. A real user pressing Ctrl+V is unaffected, but test helpers must use lowercase. |
| Phone | The window connects and the page does not scroll sideways, but the remote screen is a fixed 1280x800 shrunk to the phone's width, so text is tiny: `supplier-session/04-phone.png`. Usable to look at, poor for typing or a CAPTCHA. This confirms the spec: desktop is the supported way to connect, a phone is best effort. A later option is to resize the virtual screen to the client's size. |

## Surprises

1. **Port 4190 is blocked by Node's `fetch`** (it is on the browser "bad ports" list, ManageSieve) and gave `TypeError: fetch failed: bad port`. The spike moved the host port to 4191. **Do not use 4190 (or other fetch-blocked ports) for anything a browser or Node client calls.** The app's API stays on 3000.
2. x11vnc logs keysym warnings at start and `Xlib: extension "DPMS" missing`. Harmless. Its `-debug_sel` option logs clipboard text, so it must never be enabled outside debugging. The spike uses `-quiet`.
3. x11vnc runs with no password because the port is reachable only from the proxy over the private network. The real design must keep it that way (task 12 checks it).

## What the spike did not cover

- A real supplier, a real CAPTCHA solve, or MFA. Those need the owner and are for task 14.
- Cold start time, running for the full 15 minutes, or two clients at once.
- A seccomp profile. The default Docker profile was used and Chromium's sandbox worked as non-root, so a custom one may not be needed. Decide in task 7.
- Typing feel over a slow link.

## Owner try-out (acceptance criterion, still open)

The stack can be started again with the commands in `spikes/supplier-session/docker-compose.yml`. The owner opens the window, types a password into the fake login, and says whether it felt acceptable. Their answer goes below.

> Owner's verdict: _pending_
