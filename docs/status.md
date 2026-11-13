# Project status

Last updated 2026-11-13.

## Where the app stands

Every module is built, merged to `develop` and tried by the owner on their own stack:

| Module           | What it does                                                                                                      | Status                                            |
| ---------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| foundation       | Sign-in, owner account, database, audit log, Docker Compose stack                                                 | Done                                              |
| shopify          | Connects a store, reads products and stock, writes stock only after approval                                      | Done. Write tested on a Shopify development store |
| supplier-session | Supplier list, live login window (noVNC), saved sealed sessions, session checks                                   | Done                                              |
| mapping          | Links each Shopify variant to a supplier page (by hand, from Shopify fields or a Shopify export CSV), link checks | Done                                              |
| extraction       | Captures a supplier page, stock rules per supplier, stock checks and observations                                 | Done. Tested on the pilot supplier                |
| scheduling       | Daily automatic checks, quiet hours, two suppliers at once, retries, run history                                  | Done                                              |
| proposals        | Stock suggestions, approve one by one, safe write to Shopify                                                      | Done                                              |
| ui-shell         | Tailwind redesign, paging, notifications                                                                          | Done                                              |

What is left for the MVP:

- Release: merge `develop` into `master` (PR #122).
- README (PR #124), open for review.

Decided against (do not bring them up again unless something changes):

- A contact User-Agent and reading robots.txt crawl-delay. The owner sets the pause per supplier by hand.
- Automated database backups. The README shows a manual `pg_dump`.
- A daily check limit per supplier.
- Importing cookies from the owner's own browser (PR #117, closed).

Known open points:

- One supplier is parked: its login fails in the live window and its terms forbid automated access. The way forward is to ask it for a stock feed.
- Some suppliers' terms forbid automated access. Getting permission is the owner's call. The app records a permission decision per supplier, and link checks stay blocked until one is set.

## Keeping supplier logins alive

- After any check that finds a logged-in page, the cookies the browser ended with are merged into the saved session and saved
  again. Suppliers that extend a session on each visit then stay logged in. A new login by the owner is never overwritten.
- Two hours before each scheduled run (never in quiet hours), the login is checked. An expired login raises the usual "needs
  you to log in again" notice, so the owner can reconnect before the run.
- Logging in automatically with a stored password was decided against: it would store supplier passwords, and captchas still
  need the owner. Design: `docs/superpowers/specs/2026-11-13-session-refresh-design.md`.

## Problems we hit and how we fixed them

### Live login window

- **The browser sandbox was off.** Playwright adds `--no-sandbox` unless `chromiumSandbox: true` is set. With the sandbox on, Chromium also needs Playwright's seccomp profile (`services/browser/seccomp_profile.json`) and the `SYS_CHROOT` capability.
- **Ctrl+V did nothing.** noVNC never reads the owner's own clipboard. Fix: a "Paste text" box sends the text into the window, and Ctrl+V then works.
- **A second tab got a 502.** Only one login window can be open at a time. Fix: a plain "already open" message (409), a way to resume or close the open window, and cleanup when the tab closes.
- **The browser did not start after a container restart.** A stale X lock file was left behind. Fix: `entrypoint.sh` removes stale `/tmp/.X99-lock` files at start.
- **Port 4190 failed.** Node's `fetch` blocks it ("bad port"). Do not use fetch-blocked ports.
- **Shopify storefronts rejected a solved captcha** in the controlled window. Chromium tells every page `navigator.webdriver = true` while any remote-control channel is open. Fix: a plain login window (`LOGIN_WINDOW_MODE=plain`) with no control channel. When the owner finishes, the browser gets SIGINT (SIGTERM loses cookies) and its cookie file is read offline.
- **The browser looked like a fresh UTC Linux machine.** Fix: `BROWSER_TIMEZONE` and `BROWSER_LANGUAGE` (the `--lang` switch does not change `navigator.language` on Linux, so the language is seeded in the profile).
- **Every login looked like a first-time visitor.** Fix: `LOGIN_PROFILE=persistent` keeps one browser profile per site while the container runs.

### Checks against suppliers

- **Headless checks got a 403 and a captcha** from some suppliers even with a valid session. Fix: `VERIFY_MODE=profile` checks from an ordinary headed Chromium on a private screen, reading the title from its history. When the title is blank or unclear, a second step reads the page text. No spoofing, stealth or captcha solving, ever.
- **Hidden captcha widgets and password fields read as a wall.** Fix: the page classifier ignores hidden elements.
- **A login, captcha or block in the middle of a check went unnoticed.** Fix: link and stock checks now mark the supplier as needing the owner.
- **One site stalled every later check.** In profile mode, each check's proxy listener waited on tunnels that the site (behind Cloudflare) never closed, and checks run one at a time. Fix: the listener destroys its own sockets on close. A browser killed by a signal is now detected by `signalCode` too.
- **Long pages lost most of their picture.** A full-page PNG over 1 MB fell back to the visible part. Fix: try a full-page JPEG (quality 80) first. The API sends `image/jpeg` or `image/png` from the file's first bytes.
- **Stock rules with no heading read the whole page,** so a related product's "Out of stock" decided the answer. Fix: they look only at the main product.
- **Page-reading scripts crashed under tsx.** Fix: the page gets a `__name` helper.

### Jobs and Shopify

- **A supplier link run was re-run part way.** pg-boss expires a job after 15 minutes by default and then retries it. Fix: a longer `expireInSeconds` and `retryLimit: 0` for link runs.
- **An unclear Shopify write could be applied twice.** Fix: re-read Shopify's number after an unclear write, one apply worker at a time with a lease, and trace each write.
- **Shopify 2026-10 removed `ignoreCompareQuantity`.** Fix: stop sending it.

### Tests and CI

- Flaky tests fixed: concurrent sync (made deterministic), and the e2e capture toast (use `.last()`).
- `create-owner` could not read piped input. Fixed.
- The project moved from pnpm to npm workspaces (PR #11).
- Tests use isolated Docker projects (testcontainers), never the owner's stack or `.env`.
- Required checks on `develop` and `master`: check, e2e, docker, gitleaks.
