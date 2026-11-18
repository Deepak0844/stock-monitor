# Keep login alive

Status: approved by the owner 2026-11-18. This is project 1 of `2026-11-18-robust-auto-login-roadmap.md`.

## Why

Some suppliers log you out after about an hour idle. Today only stock runs keep a session alive, so these suppliers
need a new login on almost every run. A login can mean a captcha to solve by hand, or a code. Keep-alive visits the
supplier with the saved session often enough that it does not time out.

## Goals and non-goals

- A per-supplier choice: off, or every 15, 30, 45, 60 or 120 minutes. It is off by default.
- It works with automatic login and with hand login. The captcha supplier is the main case.
- It never runs outside the supplier's check window. A window of both null means all day. So an idle-logout supplier
  logs you out overnight and needs one login a day; the owner accepted that.
- Non-goals: email alerts (project 2), and keeping a browser open.

## Approaches

1. **Chosen: run it from the existing tick.** The tick queues the existing `supplier.session.verify` job with
   `keepAlive: true`. It reuses the session check, the kept profile, stealth, the cookie refresh and the notices.
2. A separate timer per supplier. Rejected: more moving parts than the tick already handles.
3. A browser left open and reloading. Rejected: memory on a 4 GB server.

## Design

- **Data.** Migration 0018 adds two columns to `suppliers`:
  - `keep_alive_minutes`: an integer, null when off, with a check that it is one of (15, 30, 45, 60, 120).
  - `keep_alive_next_at`: a timestamp with time zone.
- **When a visit is due.** This is a pure function in `@stock-monitor/scheduling`,
  `keepAliveDue({ now, minutes, nextAt, lastVerifiedAt, window, timeZone, rand })`. It returns one of:
  - `{ due: true, nextAt }`: queue a visit now, and the next one is due at `nextAt`, which is `now + minutes × (1 + spread)`.
  - `{ due: false, nextAt }`: store this `nextAt`, if it differs from the stored one.

  The spread is a random value between −10% and +10% (`rand()·0.2 − 0.1`). It gives `{ due: false }` when:
  - the time is outside the window;
  - `nextAt` is still in the future;
  - the last successful visit, which any check or run counts as, was less than `minutes` ago. In that case the next
    visit moves to `lastVerifiedAt + minutes × (1 + spread)`.
- **The tick.** Every minute, it looks at each supplier with keep-alive on that:
  - passes `whyNotChecked`, so it has a saved session, permission, is not paused and is not waiting for the owner;
  - is not running;
  - is due.

  For each one it writes `keep_alive_next_at` first, then queues `supplier.session.verify { supplierId, keepAlive:
  true }` with `retryLimit: 0`. A visit that cannot reach the supplier is therefore not queued again on every tick.
- **The visit.** It is `verifySupplierSession` with `keepAlive`:
  - **`ok`:** the same as today, so the cookies are merged and the session is marked verified.
  - **`login_required`, automatic login on and not paused:** `ensureLoggedIn(force)`. When that gives ready, the result
    is ok. Otherwise the login has already raised its notice.
  - **`login_required`, hand login:** the usual notice.
  - **An unclear page:** nothing is marked, as with the early check.
- **API.** `PUT /api/suppliers/:id/schedule` accepts an optional `keepAliveMinutes`, either one of the list or null.
  When it is omitted, nothing changes. Setting it clears `keep_alive_next_at`. The supplier record returns it.
- **Screen.** The Schedule card gets a "Keep login alive" select: Off, or every 15, 30, 45, 60 or 120 minutes. A hint
  under it reads "Visits the supplier with your saved login so it does not log you out. Only inside the hours above." It
  is saved with the card's existing Save button.
- **Audit.** Each visit writes the usual `supplier.session_checked` with `keepAlive: true`.

## Left to the builder

The file layout, the test shapes, and the docs wording.
