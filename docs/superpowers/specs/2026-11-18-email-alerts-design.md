# Email alerts and a re-run after hand login

Status: draft for the owner, 2026-11-18. This is project 2 of `2026-11-18-robust-auto-login-roadmap.md`.

## Why

Today a login problem shows only as a Dashboard notice. The owner is not looking at the Dashboard most of the time. So a
captcha or a lost session can leave a supplier unchecked for hours. The owner wants an email that says which supplier
needs a login, with a link to the place to log in. After the hand login, the check that stopped should run again by
itself.

## Goals and non-goals

- Email the owner once for each new login problem. A login problem is an open notice of kind
  `supplier_needs_reconnect`, whatever its reason: login needed, puzzle, code, blocked, unclear, wrong password, locked
  account, or login form not found.
- The email names the supplier, says what is wrong (the notice's own wording), and links to the supplier's login page
  in the app.
- After a hand login proves good, re-run the supplier's check when its last run was stopped by a login problem.
- Emails are sent through Gmail SMTP from the new Gmail used only for suppliers, with an app password (owner's
  decision).
- Non-goals:
  - Emails for changed pages (`recipe_needs_review`) or Shopify problems (`proposal_needs_attention`). The owner chose
    login problems only.
  - Reminder emails for a notice still open.
  - A "send a test email" button.
  - Email login codes (project 3).
- Anti-goals:
  - A burst of emails for old notices on the first deploy.
  - An email that holds a password, a cookie or a session.
  - A run that waits on Gmail.

## Approaches

1. **Send inside the check.** It is the least code. But a run waits on Gmail, and a failed send is lost.
2. **A queued send job per notice.** It retries through the queue. But it adds a job type, and the email is lost when
   the queue is down at the moment of the notice.
3. **Chosen by the owner: a sweep in the minute tick.** A notice gets an `emailed_at` time. Every tick sends one email
   for each open login notice whose `emailed_at` is empty, then stamps it. A failure leaves it empty, so the next tick
   tries again. A notice that closes before the next tick, for example because automatic login fixed it, sends
   nothing. The cost is up to a minute's delay and one column.

## Design

- **Data.** Migration 0019 adds `emailed_at timestamptz` to `notifications`. The same migration sets
  `emailed_at = now()` on every notice open at that moment, so the first deploy sends no email for old notices.
- **When a notice is raised again.** `raise` updates an open notice, for example from login needed to puzzle. It does
  not clear `emailed_at`, so the problem is not emailed twice. A notice that is resolved and then raised again is a new
  row, so it gets a new email.
- **Settings.** There are three new `.env` settings, passed to the worker only:
  - `ALERT_EMAIL_FROM`: the supplier Gmail address. It is also the SMTP user.
  - `ALERT_EMAIL_APP_PASSWORD`: its Google app password.
  - `ALERT_EMAIL_TO`: where alerts go, for example the owner's usual email.

  If all three are blank, alerts are off. The Dashboard works as today, and the worker logs once at start that email
  alerts are off. If only some are set, the config refuses to start and names the missing ones. The password is never
  logged.
- **Sending.** Mail goes to `smtp.gmail.com` on port 465 over TLS, through `nodemailer` (a new dependency). An SMTP
  client written by hand is not worth the risk. There is one connection timeout of about 15 s.
- **The sweep.** In `runTick`, after the runs and the keep-alive visits:
  - Read the open `supplier_needs_reconnect` notices with `emailed_at` null, oldest first, at most 10 a tick.
  - Claim each one before sending: set `emailed_at = now()` only where it is still null and the notice is still open,
    and skip it if no row changed. This avoids an email for a notice that closed a moment earlier, and a second email
    from a tick that overlaps. (Builder's call.)
  - Then send. On failure, clear `emailed_at` again, so the next tick tries again, and log a warning with the supplier
    id and the error code only.
  - Do not let a send failure stop the tick: catch each one.
- **The email.**
  - Subject: `<supplier name> needs you to log in`.
  - Body: plain text. It holds the notice's message, then `Log in here: <APP_ORIGIN>/suppliers/<id>/connect`, then one
    line saying this was sent by Stock Monitor. When `APP_ORIGIN` is blank, the link uses `http://localhost:3000`, the
    same default the app uses.
  - `docker-compose.yml` passes `APP_ORIGIN` to the API only today, so it is added to the worker too. Without it,
    links on the server would point at localhost.
- **Re-run after a hand login.**
  - **What already happens.** A run stopped by a login problem leaves `next_check_at` as it was, which is already due.
    When the hand login marks the supplier connected again, the next tick starts its run. So a scheduled run that
    stopped re-runs today with no new code. This stays as it is.
  - **What is missing.** A run the owner started with **Check all stock** keeps the supplier's later `next_check_at`,
    so it waits for the schedule. A supplier with automatic checks off never re-runs.
  - **The change.** The finish of a hand login (`POST .../finish` in `login-sessions.ts`) already queues
    `supplier.session.verify`. It now sends `{ supplierId, afterLogin: true }`, which is added to the strict job
    schema.
  - `afterLogin` is a plain session check, never a forced login. The existing rule stands: the check after a
    live-window login stays plain. The **Check login** button (`login: true`) is unchanged and does not re-run.
  - When that check ends ok, and the supplier's newest ended run is `stopped` with a login stop reason, the handler
    re-runs it. A run only ever stops for a login with `login_required`, `captcha` or `blocked`: a failed automatic
    login maps to one of these.
    - **Automatic checks on:** set `next_check_at` to now, if it is later than now. The next tick starts the run
      through the usual gate, window and limit of 2 runs at once.
    - **Automatic checks off:** start the run at once, the same way **Check all stock** does: a `manual` run record,
      then the `extraction.checks` job. It is not started if a run is already going, or if the stock gate refuses the
      supplier.
  - It records the audit event `supplier.rerun_queued`.
- **Docs.** `docs/deployment.md` gets an "Email alerts" section covering:
  - making the supplier Gmail's app password (2-Step Verification on, then App passwords);
  - the three settings and a redeploy;
  - what is emailed and what is not;
  - that a failed send is tried again every minute;
  - the re-run after a hand login.

  `.env.example` gets the three blank settings with one comment.

## Left to the builder

- The file layout. For example, a small `mailer.ts` in the worker, taking a send function so tests use a fake.
- The test shapes, and the exact docs wording.
- Whether the sweep's query lives in the notification repository. That is the likely place.
