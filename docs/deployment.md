# Deployment

Single server, Docker Compose. The API serves the web app, so there is no separate web container.

## What runs

| Service | Role |
|---|---|
| `postgres` | PostgreSQL 17. Data lives in the `pgdata` volume. Not published to the host. |
| `migrate` | Runs once per deploy: applies migrations and sets the password of the restricted `stock_app` login role. |
| `api` | Fastify API plus the built web app, on `127.0.0.1:3000`. Runs as a non-root user. |
| `worker` | pg-boss job worker. Checks that a saved supplier login still works. |
| `browser` | The only place a supplier's website is ever opened: Chromium with a virtual screen for the live login window. No database access, no encryption key, no published port. See "The browser service" below. |

The API and worker connect as `stock_app`, which can add and read audit events but cannot change or delete them. Only the `migrate` step uses the database owner.

## First run

```bash
cp .env.example .env          # then fill in the four secrets, using the commands inside
docker compose up -d --build
docker compose run --rm api node --import tsx apps/api/src/cli/create-owner.ts
```

Open http://127.0.0.1:3000 and sign in. For plain-http local use set `COOKIE_SECURE=false` in `.env`. Use `true` behind HTTPS.

## Updating

`git pull`, then `docker compose up -d --build`. Migrations run automatically before the API and worker start.

**Updating from before the browser service existed:** add one line to your `.env` first, or Compose stops with a message naming it.

```bash
openssl rand -hex 24          # paste the result as BROWSER_CONTROL_TOKEN=... in .env
```

Also set `APP_ORIGIN` in `.env` to the address you open the app at, if it is not `http://localhost:3000` or `http://127.0.0.1:3000` (for example `https://stock.example.com`). The live login screen refuses pages from any other origin.

## The browser service

Supplier websites are the least trusted thing in the system, so they are opened in their own container. The aim is that the worst a hostile page can do is stay inside that container.

- **Networks.** There are three. `default` holds the database, the API and the worker. `control` is private to the API, the worker and the browser container, and has no route to the internet. `egress` holds the browser container alone, so it can reach supplier websites and nothing else of ours. The database is on neither of the browser's networks, so the browser cannot even look up its name.
- **No published ports.** Its control port (8080) and its screen port (5900, VNC) are only reachable from the API and worker over `control`. A test checks that nothing is published and that the container is not on the default network.
- **Locked down.** It runs as a non-root user, with every capability dropped except `SYS_CHROOT` (Chromium's own sandbox needs it to confine its helper processes), `no-new-privileges`, a read-only filesystem (only `/tmp` and its home folder are writable, in memory), no host folders, and limits of 2 GB of memory, 2 CPUs and 512 processes. Chromium's own sandbox stays on, which is why it uses Playwright's seccomp profile (`services/browser/seccomp_profile.json`, unchanged from Playwright's v1.65.0 tag) in place of Docker's default.
- **Two locks on every call.** The API and worker prove themselves with `BROWSER_CONTROL_TOKEN`. The live screen needs a signed-in owner, an allowed origin and a one-time token, and the VNC server has its own random password, made fresh each time the container starts.
- **It never gets a private address.** Everything Chromium loads goes through a proxy inside the container that refuses private, loopback, link-local and cloud-metadata addresses, checks redirects, and connects to the address it checked.
- **What it does not have.** No database credentials, no encryption key. Saved sessions are decrypted by the API and worker, and handed to the browser container only for the moment of a check.

Server-level steps that are not in Compose:

- **Block the browser container from your own network.** On a server, add firewall rules so containers cannot reach private ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16) or the cloud metadata address 169.254.169.254, except Docker's own networks. The proxy already refuses them, and this is the second wall behind it.
- On a Mac used for the pilot, the supplier sees your home internet address. On a server it sees the datacentre's, which some suppliers distrust.
- A compromised Chromium could reach the API's port over `control` (it would still need a signed-in session). If that worries you, the next step is a firewall rule on the control network.

## Connecting a supplier

This is how you give the app access to a supplier's website, so it can check stock without you. **You log in yourself, by hand.** The app never asks for your supplier password, never stores it, and never logs in for you.

### Before you start

1. **Check the supplier's terms.** Look for anything about automated access, bots or scraping. The app only ever uses a login you made, and checks gently, but the supplier's terms decide whether it is allowed. This is your call, not the app's.
2. **Use a computer.** The login window works best on a desktop browser. A phone can see status and messages, but a puzzle or a code is hard to handle on a small screen.
3. **Check the app is ready.** `BROWSER_CONTROL_TOKEN` is set in `.env` (see "The browser service" above), and `docker compose ps` shows `browser` as healthy.

### Connecting

1. Open **Suppliers**, then **Add supplier**. Give it a name, its website address (starting with `https://`), and, if its login page is somewhere else, the login address. The app refuses addresses that are not plain public websites.
2. Press **Connect** on that supplier. After a few seconds a window appears in your page. It is the supplier's real website, running in a locked-down browser on the server.
3. **Log in as you normally would.** Solve any puzzle (CAPTCHA) or code, and complete any text-message or app check. Click inside the window to type into it.
4. If you want to paste a password from your password manager, put it in **Paste text**, press **Send to the window**, click the field in the window, then press **Ctrl+V**. The box is cleared after sending.
5. When you can see you are logged in, press **I'm logged in**. The window closes and the supplier shows **Connected**.

You have 15 minutes. The clock is shown. If time runs out, or you press **Cancel**, or you leave the page, the window is closed and **nothing is saved**.

### What the statuses mean

| You see | It means | What to do |
|---|---|---|
| Not connected | No login has been saved yet. | Press **Connect**. |
| Connected | The last check found the login working. | Nothing. |
| Needs reconnecting | The supplier has logged you out, or the page looked like a login. The app paused this supplier and left a message on the Dashboard. | Press **Reconnect supplier**, log in again, press **I'm logged in**. |
| Blocked | The supplier is showing a puzzle or blocking access. | Press **Reconnect supplier** and see whether you can get in. If it keeps happening, the supplier may not want automated visits: stop and check its terms. |
| Paused | You paused it. | Press **Resume** when you want it checked again. Reconnecting does not undo your pause. |

**Check connection** asks for a check straight away. The result appears in a few seconds.

### Things to know

- **The supplier sees the server's address, not yours.** On your own Mac that is your home internet address. On a server in a datacentre, some suppliers distrust it and ask for more puzzles.
- **A saved login does not last forever.** How long depends on the supplier. When it ends, the app notices, pauses that supplier only, and asks you to reconnect. It never treats a failed check as "out of stock".
- **One account per supplier, one login at a time.** Only one login window can be open. If you see "A login window is already open", finish or cancel that one first.
- **Keys only reach the supplier's page while you have clicked into the window.** The app does not log or store anything you type.
- **If something looks wrong,** note the exact message and tell the developer. The messages are written to be read, for example "The login window could not be opened. Please try again."

### Your timezone and language

The browser container runs in UTC with no language set, which can look odd next to your real address and can make a supplier's puzzle (CAPTCHA) reject a login. Set `BROWSER_TIMEZONE` (for example `Asia/Kolkata`) and `BROWSER_LANGUAGE` (for example `en-IN`) in `.env` to your real ones, then run `docker compose up -d browser`. They only say where and how you really browse. Nothing is faked, and blank keeps the old behaviour. An unknown timezone or a badly written language stops the service from starting, with a plain message.

### Login window mode

`LOGIN_WINDOW_MODE` in `.env` chooses how the live login window is run. After changing it, run `docker compose up -d browser` to recreate the browser container.

- **`controlled`** (the default). The window is a Chromium that the app's automation tool launches and keeps in contact with. This is the original way.
- **`plain`**. The window is an ordinary Chromium that nothing is controlling while you log in. Use it if a supplier's puzzle (CAPTCHA) rejects you in the live window even though your own browser is accepted: puzzles and bot checks can refuse a browser that an automation tool is driving. When you press **I'm logged in**, the browser is closed the way a person would close it, and the login is read from its temporary profile, which is then deleted.

Both modes look and work the same to you, including the **Paste text** box. In `plain` mode a password you type is never saved by the browser (saving, autofill and sign-in are turned off in its profile), the sandbox stays on, and everything it loads still goes through the same network guard. `plain` does not disguise anything: the browser says what it is. It also does not make the supplier's later automated checks any less visible to the supplier, and the supplier's terms still decide whether those are allowed.

### Record your permission decision

After connecting, open the supplier's **Edit** page. The **Permission to check automatically** box is your own record of whether the supplier allows automatic checks: **Not recorded** (the default), **Allowed** or **Not allowed**, with a note (for example who you asked and when) and the **pause between pages** in seconds. Link checks are refused until the supplier is **Allowed**. It is a reminder and a record, not a legal control: you set it, and the supplier's terms still decide what is allowed. Set the pause to at least the delay the supplier's `robots.txt` asks for.

### The pilot supplier

What the pilot supplier showed when it was connected by hand (2026-11), with its name left out because this repository is public:

- **The login showed a puzzle (CAPTCHA).** It was solved by hand in the live window, and the login was accepted.
- **The saved login lasted for at least several hours.** The exact limit is not known yet. The app will notice when it ends and ask you to reconnect, so there is nothing to do in advance.
- **The owner read the supplier's terms and recorded the permission decision** on the supplier's Edit page before any check.

Earlier trials with other suppliers showed that a supplier's bot protection can accept a login by hand and still refuse the app's automated check (the check then shows **Blocked**, never a broken link or "out of stock"). If that happens, the options are to ask the supplier for a price list or feed, or to leave that supplier paused.

## Stock rules

Stock rules tell the app how one supplier's product pages show stock, so it can say whether an item is **In stock**, **Out of stock** or **Cannot tell**. You build them in the app, from a saved copy of a real page. Nothing is clicked, typed or scrolled on the supplier's site, and nothing is written to Shopify.

### Before you start

The supplier must be **connected**, **running** and recorded as **Allowed** on its Edit page (see "Record your permission decision"). Without that, captures and stock checks are refused with a plain message.

### Setting rules up

1. Open **Suppliers**, then **Stock rules** on the supplier's row.
2. **Capture a page.** Choose one of the supplier's links and press **Capture a page**. In a few seconds it appears in the list. Press **View** to see its picture and the words the page showed. The picture is only for you: the app reads the words, never the picture.
3. **Label examples.** For each saved page, choose the answer you expect (for example "In stock" for a page that shows stock, "Out of stock" for a sold-out page) and press **Save label**. Capture at least one of each kind you want to be sure about.
4. **Build the rules.** Each rule is one question about the page: *text on the page* or *button on the page* (and whether the button must be enabled). Rules can be limited to the part of the page **under a heading**, so a "Sold out" badge on a related product does not decide your item.
   - **Page checks:** words that must be on a normal product page. If one is missing, the page has changed and the answer is Cannot tell.
   - **In stock when / Out of stock when:** any one matching decides. Both matching, or neither, is Cannot tell.
   - **Quantity (optional):** a number that follows a label, for example "Units left".
   - **Region (optional):** for a supplier that lists stock by region, the heading above the list of regions and numbers. The region itself is set on the supplier's Edit page (a default) or on a link (its own).
5. **Test all examples.** The app runs your rules on every labelled saved page and says which give the answer you expect.
6. **Save version**, then **Turn on**. A version can only be turned on when every labelled example passes. Saving never turns anything on and never changes an older version.

### Checking stock

On **Links**, press **Check stock** on a link, or choose a supplier and press **Check all stock** (one page at a time, with the supplier's pause between pages). The answer appears in the Stock column a moment later, with the reason when it is Cannot tell. **History** shows a link's earlier answers and the rules version used.

### What the answers mean

| Answer | Meaning |
|---|---|
| In stock (12) | Your in-stock rules matched and nothing contradicted them. The quantity is shown when your rules read one. |
| Out of stock | Your out-of-stock rules matched, or the region's number is 0, or the region is **not listed** while the rest of the region table is still on the page. |
| Cannot tell | The app is not sure, and says why: the **page changed**, the rules disagreed or found nothing, the quantity and the wording disagree, the check did not work (login needed, puzzle, blocked, supplier unreachable), the page is missing, or the address never worked. **Cannot tell is never treated as out of stock.** |

When many of a supplier's pages change at once, you get one message on the Dashboard ("<supplier>'s pages changed. Review its stock rules.") with a link back to the rules. Open the saved copy the app kept, point the rules at the new wording, test, and turn on a new version.

### Things to know

- **Saved pages are private.** A capture can show account names or wholesale prices. Only you can see it, it never goes in a log, and unlabelled and page-changed captures are deleted after 30 days (the clean-up runs when a capture or a check is requested). Labelled examples stay until you delete them: delete them when you no longer need them.
- **A 404 or a redirect to the home page** is not decided by the stock rules. On a link that worked before it is "Page missing" (a candidate for "unavailable" after two checks at least 6 hours apart, for your approval later); on a link that never worked it is "Never worked", a wrong address to fix.
- **If stock only appears after a click or a scroll,** version one cannot read it. The answer is Cannot tell.

## Automatic checks

By default nothing is checked until you press a button. **Automatic checks** make the app check a supplier by itself. They are **off** for every supplier until you turn them on.

### Turning them on

Open **Suppliers**, choose **Edit** on a supplier and find **Automatic checks**:

- **How often:** every hour, 3 hours, 6 hours, 12 hours, or every day. Start with every day. A shorter interval means more visits to a supplier that may not want them, so check its terms first.
- **Hours of the day when a check may start:** 07:00 to 22:00 by default, in your timezone. A check that comes due outside those hours waits until they start. Tick **Any time of day** to remove the limit. The hours follow `BROWSER_TIMEZONE` in `.env` (the same setting as the login window), so there is nothing more to set. Restart with `docker compose up -d` after changing it.

Each run is the same as **Check all stock**: one page at a time, with the supplier's pause between pages. The next check is set one interval after the last one ended, plus a small random spread (up to 10%) so suppliers are not all visited together.

### When a supplier is not checked

A supplier is only checked automatically when it is connected, running (not paused), recorded as allowed, and has stock rules turned on. When it is not, the Suppliers list says why ("Not being checked. This supplier is paused...") and its next check is not moved: it is picked up again as soon as it is ready. At most 2 suppliers are checked at the same time.

### What stops a run

- **The supplier asks you to log in again, shows a puzzle (CAPTCHA), or refuses the check:** the run stops at once, you get a message on the Dashboard, and the supplier is not checked again until you reconnect it. The app **never retries a puzzle or a block by itself**.
- **The supplier cannot be reached** (3 pages in a row): the run stops. The next try is after 15 minutes, then 1 hour, then 4 hours, then every 4 hours until it works. A good run puts it back on its normal interval.
- **The app restarted during a run:** the run is marked "Stopped: the app restarted" and the supplier is picked up again when its next check is due.
- **After the app was switched off for a while,** a supplier that is due is checked once, not once for every check it missed.

### Reading it

- The **Suppliers** list shows the schedule, the next check, progress while a run is going ("Checking 12 of 40 links") and the last result ("Checked 40 links, 3 cannot tell").
- The supplier's **Edit** page lists the last 30 days of runs: when, whether you started it or the schedule did, and how it ended.
- On **Links**, a link that has not been checked for more than twice the supplier's interval says **Not checked recently**. Its answer may be out of date.
- **Check all stock** while a run is going is refused: "A check for this supplier is already running."

### Things to know

- Run records hold only counts and a reason. They never hold page text, addresses, or login details, and are deleted after 30 days.
- The old "Check every (minutes)" box on the supplier form is gone: it never did anything. Use **Automatic checks** instead.

## Server hardening (the checklist from the design discussion)

Saved supplier sessions are decrypted in memory while a check runs, so anyone who controls the server could use them. Encryption protects the database and backups, not a compromised server.

- SSH with keys only. Password login off, root login off.
- Firewall: allow only 22, 80 and 443. Nothing else is published.
- Automatic security updates for the operating system. Update Docker images regularly.
- HTTPS through a reverse proxy (Caddy or nginx) in front of `127.0.0.1:3000`. Set `COOKIE_SECURE=true`.
- Set `TRUST_PROXY=true` **only** if the proxy overwrites `X-Forwarded-For` with the real client address. Otherwise anyone can fake their address and dodge the sign-in rate limit. Leave it `false` with no proxy.
- `.env` readable only by the deploy user (`chmod 600 .env`). Never commit it.
- Back up `APP_ENCRYPTION_KEY` separately, for example in a password manager. If it is lost, saved sessions and the Shopify token cannot be read. They can be recreated by reconnecting.
- Encrypted, off-server database backups: nightly `pg_dump` to storage such as S3 or Backblaze, and a restore test. **Not automated yet.** It is a follow-up task.
- Check the pilot supplier's terms of service on automated access before the first real check.

## Known limits

- The sign-in rate limiter is in memory. A restart resets it.
- The main image has no Playwright browsers. The browser service has its own, larger image (about 2.6 GB).
- One login window can be open at a time, because there is one virtual screen.
- Drizzle migrations only go forward. To undo one in development, recreate the database.
- Estimated running cost for the pilot: a small VPS at about 10 to 20 USD a month, plus backup storage.
