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

### The pilot supplier

_To be filled in with the pilot supplier's name, whether it uses a puzzle or a code, how long a login lasted, and anything it showed, once the pilot is connected. Private details stay out of this file._

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
