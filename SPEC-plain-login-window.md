# Spec: plain login window (amends `supplier-session`)

Module: `supplier-session` (an amendment to the live login window, Task 7 of its plan). Intent: `docs/intent/stock-monitor.md`.

Status: **built behind a setting, awaiting the owner's try-out.** The reading-the-session design below was changed during the build (see Design 3).

## Why

The owner tried the live login window on a real supplier (a Shopify storefront). They solved Google's captcha correctly and the storefront answered "Captcha failed". The same login and puzzle work in the owner's normal browser at the same moment, on the same internet connection. We tested our network path from inside the container: it is not the cause.

Today the login window is a Chromium that our automation tool (Playwright) launches and keeps controlling. That leaves automation signals in the browser, and captcha and bot-protection systems can reject a person who is using such a browser. The most likely cause is therefore the browser, not the person or the puzzle.

## Objective

Make the login window **an ordinary Chromium that a person uses**, with nothing controlling it while they log in. Nothing attaches to it at all. When the owner presses "I'm logged in", the browser is closed the way a person would close it and the saved session is read from its profile. The owner is still the one logging in, solving puzzles and typing, exactly as before.

Success is that the owner can log in to the pilot supplier through the live window, the session is saved, and a later check reaches a page that needs the login. Nothing else about the product changes.

## What this is not

- **Not disguising anything.** No spoofed fingerprints, no stealth plug-ins, no changed browser identity, no hiding that automation exists. A person simply uses a browser that is not being driven.
- **Not solving or bypassing captchas.** The owner solves them, as before.
- **Not a promise.** The supplier's later automated stock checks may still be flagged, and the supplier's terms on automated access still decide whether any of this is allowed. If the plain window also fails, the other options stand: ask the supplier for an API, feed or allow-list, or choose a different pilot.

## Assumptions (correct me now)

1. The browser is the same Chromium that Playwright installs, launched directly with ordinary flags, **with its own sandbox still on**, in the same locked-down container (read-only filesystem, one capability, seccomp profile).
2. It is shown on the same virtual screen and shared by the same VNC server. The proxy, the one-time token, the password and the timeout work as today.
3. A temporary profile folder in memory (`/tmp`) is used and **deleted at the end**, including after a crash or timeout.
4. The old way (Playwright launches and controls the window) stays available as the default until the owner has proven the new way, selected by a setting (`LOGIN_WINDOW_MODE=controlled` or `plain`). The headless **session check is unchanged**: it is automated and says so.

## Design

1. **Launch.** The service starts the Chromium binary itself with the usual flags (a profile folder, window position and size, no first-run prompts) and a **proxy setting that points at a second, loopback-only guard proxy** with no password, used by this one window. The browser's own traffic still goes through the guard, so private and metadata addresses are still refused, including redirects and loopback.
2. **Profile.** Before launch, the temporary profile is seeded with settings that turn off saving passwords, autofill and sign-in, so a password typed into the window is never kept in the profile. The folder is removed when the window ends.
3. **Reading the session.** *(Changed during the build.)* The first design opened a debugging channel on `127.0.0.1` and attached at the end. That does not work: Chromium tells every page it is automated (`navigator.webdriver`) as soon as any such channel is open, so the window would have looked driven the whole time. Instead there is **no channel at all**. When the owner presses "I'm logged in", the service asks the browser to shut down gracefully (SIGINT), which writes its cookies to the temporary profile, then reads the cookie file offline (on Linux with `--password-store=basic`, values are encrypted with a fixed, well-known key). Cookies with no expiry are kept because the profile is seeded to "continue where you left off". Local storage is not read; the pilot's login is cookie based.
4. **Ending.** Cancel, finish, time out, or the owner closing the window all stop the process and delete the profile. One window at a time, 15 minutes, as today.
5. **Tests.** The existing tests (types a login into the window, saves, reuses in a fresh headless check, leaves no process or profile behind) run against **both** modes. For the plain mode a test-only helper may attach to type into the page, because tests cannot use a mouse.

## Commands

`npm run check`, `npm run test:browser`, `npm run test:container`. No new commands.

## Project structure

```
services/browser/src/window.ts         the current window opener (controlled)
services/browser/src/plain-window.ts   the new opener (plain launch, session read from the profile at the end)
services/browser/src/config.ts         LOGIN_WINDOW_MODE
services/browser/src/proxy.ts          a second, loopback-only listener for the plain window
services/browser/test/                 tests for both modes
docs/spikes/supplier-session.md        results of the owner's comparison
```

## Testing strategy

Test-first. **Unit:** the profile seeding (password saving and autofill off), the launch flags (sandbox on, no automation switches), and the setting parsing. **Real Chromium:** the full chain in plain mode (type a login, finish, reuse in a headless check), the guard still refusing a redirect to a private address and to loopback, no leftover process or profile after finish, cancel, time-out and the owner closing the window, and **no password or cookie value in any file in the profile**. **Container:** the same inside the hardened image, with the sandbox verified on. **Owner try-out:** the real supplier, in each mode, on the same day.

## Boundaries

- **Always:** keep the sandbox on, keep the guard proxy in the path, delete the profile, keep any test-only debugging channel out of the service's normal run.
- **Ask first:** adding a dependency (none planned), changing the container's permissions (none planned), making plain the default.
- **Never:** spoof or hide the browser's identity, auto-solve a captcha, save a supplier password, open a remote-control channel on a window a person is using.

## Success criteria

1. In plain mode the owner logs in to the real supplier through the live window, **including its captcha**, and the session is saved. (If this fails, the experiment has answered the question and we stop.)
2. A check afterwards, from a fresh headless browser, reaches a page that needs the login, or the app says plainly why it did not.
3. In plain mode, nothing controls the browser until the owner presses "I'm logged in".
4. A password typed into the window is not saved anywhere in the profile, and the profile is gone afterwards, whichever way the window ended.
5. The window is still behind the guard proxy: a redirect or typed address to a private network is refused.
6. There is no debugging channel at all while the owner uses the window (a test-only helper may open one so tests can type).
7. Both modes pass `npm run check`, the browser tests and the container tests. The controlled mode is unchanged and still the default.

## Plan in two steps

1. **Build plain mode behind the setting**, with tests, merged with the default unchanged. The owner then sets `LOGIN_WINDOW_MODE=plain` in `.env`, rebuilds, and tries the real supplier. This is the experiment, and it can be switched back instantly.
2. **Only if it works:** the owner decides whether to make plain the default. If it does not work, the setting stays off, we record what we learned, and we take one of the other options.

## Open questions

1. Is a setting (kept off until you try it) the right way to roll this out, rather than replacing the current window outright?
2. Anything about the window you want kept exactly as it is today (size, the browser's address bar being visible, the Paste text box)? I plan to keep all of them.
