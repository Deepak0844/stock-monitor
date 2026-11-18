# Robust automatic login: roadmap

Status: order agreed with the owner 2026-11-18. Each project below gets its own short design and plan before it is built.

## Why

The owner wants supplier stock checks that keep running with as little hand work as possible. Suppliers log in in four
different ways, and the app must handle each one:

- a captcha at every login;
- a logout after about an hour idle;
- an email code at login;
- a plain login whose session lasts for days.

When the app cannot get through, it tells the owner by email and makes the hand login quick.

## How it works today

- **Parts.** Web app (React) and API (Fastify) over Postgres, a worker running pg-boss jobs, and one browser service
  container. The browser service has two virtual screens: `:99` for the live login window over noVNC, and `:98` for
  checks and automatic login. It also has a guard proxy and one kept profile per supplier, in `/tmp/sm-profiles` on
  tmpfs. It holds no database access and no keys. The worker unseals a password for one login call at a time.
- **Run.** Every minute, `scheduling.tick` starts the suppliers that are due, at most 2 at once. It uses the same gate
  as the checker: permission, connected, rules, quiet hours. Two hours before a run, `supplier.session.verify` checks
  the login. The run itself goes like this:
  1. `ensureLoggedIn` runs once at the start. It skips if the session was confirmed in the last 10 minutes.
  2. The run visits each link with the supplier's pause between visits, and merges the refreshed cookies after every
     logged-in page.
  3. A login page mid-run gets one more login.
  4. A captcha or a block stops the run, and so do 3 unreachable links in a row.
  5. Then come observations, suggestions, the owner's approval, and the Shopify write.
- **Login results.** `ok` saves a sealed session; an owner login made in the meantime wins. `captcha`,
  `code_required`, `blocked` and `form_not_found` stop the run with a dashboard notice. `wrong_password` and
  `account_locked` pause automatic login.
- **Hand login.** The plain Chromium has no control channel, and its cookies are read from the profile after a clean
  quit. With the stealth switch on (PR #160), it reports a real graphics card and Google Chrome's brands. A solved
  captcha then passes.

## Weak spots

1. A captcha supplier can never log in automatically.
2. Sessions are kept alive only by checks.
3. Kept profiles are lost on every restart, so suppliers see a new device.
4. The server's datacenter address is untested.
5. Login codes are not supported.
6. The only fallback is a dashboard notice.
7. A few passes a day may not fit on e2-medium (4 GB, 2 runs at once) with thousands of links. At about 20 s a link,
   3,000 links take about 8 hours for one pass.

## Decisions (owner)

- When automatic login cannot get through, the owner is told and logs in by hand.
- Keep-alive is a per-supplier switch with its own interval. It is off by default and never runs in quiet hours.
- Alerts go by email, sent through Gmail SMTP from a new Gmail used only for suppliers, with an app password.
- Login codes go to the owner's existing email. A Gmail filter there forwards only the supplier code emails to that
  new Gmail. The app reads only the new Gmail (IMAP, app password).
- Kept profiles move to a Docker volume on disk. They hold cookies, so anyone with access to the server disk can read
  them. The sealed copies in the database stay as they are.
- Scale: 10 to 30 suppliers, and stock a few times a day. The server is GCP e2-medium (4 GB).
- No deployment until the owner has tested everything locally. The datacenter-address test comes after the first
  deploy.
- A proxy is considered only for suppliers that fail from the server.
- Never solve a captcha. Firecrawl, Crawlee and Camoufox are not used.

## Order

| # | Project | Done when |
|---|---|---|
| 0 | Merge #159 and #160. Kept profiles on a Docker volume. Full local test of each supplier's login | Every supplier is known as automatic, code, or hand-with-captcha, and profiles survive a restart |
| 1 | Keep-alive per supplier | An idle-logout supplier stays logged in across a day without a new login |
| 2 | Email alerts with a link to the login window, and a re-run after a hand login | A stopped run emails the owner. Finishing the login re-runs the check |
| 3 | Email codes (IMAP read of the forwarded code) | A code supplier logs in with no hand step |
| 4 | Throughput: measure real link counts and time per link, then set pauses and intervals per supplier within 2 runs at once | A sized schedule that gives a few passes a day, or a stated need for a bigger machine |
| 5 | Proxy, only for suppliers that fail from the server (after the first deploy) | Each failing supplier works through a proxy, or is marked hand-only |
