# Spec: scheduling

Module id: `scheduling`. Depends on: `foundation`, `supplier-session`, `mapping` (link status, permission gate, pause between pages), `extraction` (stock checks, observations). Map: `CAPABILITY-MAP.md`.

Status: **draft v2, all open questions answered (2026-11-10); awaiting approval.** No plan and no code until it is approved.

## Objective

Today a check runs only when the owner presses a button. This module makes the app check each supplier on its own, at an interval the owner chooses, without the owner watching, and without ever hammering a supplier. The owner can still press **Check now**. The owner can see what is running, what ran, and what went wrong, in plain words.

User: the store owner, not technical. Success: the owner sets "every 6 hours" on a supplier once, and afterwards finds fresh answers on the Links page, with a clear note on the Dashboard only when something needs attention. A login that expired or a block never leads to repeated attempts.

## What exists today that this builds on

- `extraction.checks` (one supplier, every enabled link, one page at a time, the supplier's own pause between pages) and `extraction.check` (one link). One visit gives both the stock answer and the link status.
- A gate (`whyNotChecked` plus "has active rules") that refuses a check unless the supplier is connected, running, recorded as allowed, and has active stock rules.
- pg-boss queue with long-run options (`expireInSeconds`, `retryLimit: 0`), notifications (one open per kind and supplier), the audit log.
- No interval, schedule, run record or progress exists yet.

## Assumptions (correct me now)

1. **One interval per supplier**, chosen from a short list (see open questions). Default: **off**. A supplier is never checked on a schedule until the owner turns it on; when turned on, the interval starts at daily.
2. **A scheduled run is the same run as "Check all stock"**: same gate, same one-page-at-a-time, same pause. Scheduling only decides *when* it starts. No second way of visiting a supplier.
3. **One run per supplier at a time.** A second start (scheduled or Check now) while one is running is refused with a plain message, never queued behind it.
4. **A small limit on suppliers running at once** (see open questions), because each live page costs the browser service memory.
5. **A run is recorded.** Each run has a row: supplier, how it started (scheduled or by the owner), when it started and ended, how many links it had, how many it finished, how many answered in stock, out of stock and cannot tell, and why it stopped if it did not finish. Progress is read from that row ("Checking 12 of 40").
6. **Failures never cause fast retries.** See "Failures and backoff".
7. **After downtime the app runs a due supplier once**, not once for every missed slot.
8. **Times are shown in the owner's timezone** (the existing `TZ` setting).
9. Scheduling never reads anything new from a supplier, never changes Shopify and never proposes anything.

## Behaviour

1. **Setting.** Each supplier has an interval (off, or one of the allowed values) and a **next check** time. Saving an interval sets the next check (moved into the quiet-hours window if it falls outside) to one interval from now, with a small random spread (up to 10% of the interval) so suppliers do not all start together.
2. **Due runs.** A tick in the worker runs every minute, finds suppliers whose next check has passed and that pass the gate, and starts a run for each, up to the limit at once. A supplier that fails the gate (paused, not connected, not allowed, no active rules) is skipped, its next check is **not** moved forward, and the supplier row says why it is not being checked. Skipping writes nothing to the supplier's site.
3. **Check now.** The existing buttons stay. A manual run does not change the schedule, except that when it finishes the next scheduled check moves to one interval after it ended, so the supplier is not visited again right away.
4. **Progress.** While a run is going, the Suppliers screen and the Links page show "Checking 12 of 40 links", from the run row. When it ends: "Checked 40 links, 3 cannot tell" (plain words), with the time.
5. **Run history.** A supplier's recent runs (last 30 days) can be opened: when, how it started, counts, and the stop reason in plain words.
6. **Stale answers.** A link whose last check is older than twice the supplier's interval is marked "Not checked recently". The app does not treat a stale answer as current.
7. **Safe shutdown.** If the worker stops in the middle of a run, the run is marked "Stopped: the app restarted" and the supplier is picked up again at the next tick after its next-check time, not immediately in a loop.

## Failures and backoff

A run looks at each page result as the existing checker already classifies it. The scheduler adds only the rules about what happens next:

| What the run found | What happens |
|---|---|
| Login needed (session expired) | Stop the run at once. The existing reconnect notification is raised. The supplier is not checked on schedule again until the owner reconnects. |
| Puzzle (captcha) or blocked | Stop the run at once. The supplier is set to Blocked as today. **No automatic retry, ever.** The owner decides. |
| Supplier unreachable or timeout | The run stops after 3 pages in a row fail this way. Next attempt: after 15 minutes, then 1 hour, then 4 hours, then the normal interval. Each success resets this. |
| Page changed on many links | Handled by the existing supplier-wide notice. The schedule continues. |
| Anything unexpected | The run is marked failed with a plain reason, backs off as for unreachable, and is audited without page content. |

The backoff steps are per supplier and are never shorter than the supplier's own pause between pages.

## Data model

| Table | Purpose |
|---|---|
| `check_runs` | One per run: `id`, `supplier_id`, `trigger` (`scheduled` or `manual`), `started_at`, `ended_at` (nullable), `links_total`, `links_done`, `in_stock`, `out_of_stock`, `cannot_tell`, `outcome` (`running`, `finished`, `stopped`, `failed`), `stop_reason` (nullable, plain code). Kept 30 days, then deleted. |
| `suppliers` (existing) | Gains `check_window_start` and `check_window_end` (local time, nullable = all day), `check_interval_minutes` (nullable, null = off, checked against the allowed list), `next_check_at` (nullable), `failure_count` (integer, backoff step). |

One running run per supplier is enforced by a partial unique index on `check_runs` (`supplier_id` where `outcome = 'running'`), so the refusal holds even with two workers.

## Security

- Job payloads stay ids only. The tick reads everything from the database.
- A run record holds counts and a stop code, never page text, addresses or session data.
- Only a signed-in owner can set an interval or press Check now. The tick runs inside the worker and has no route.
- Audit events: interval set, run started, run stopped (with the code). No content.

## Interface (all need a signed-in owner)

- `PUT /api/suppliers/:id/schedule` set or turn off the interval.
- `GET /api/suppliers/:id/runs` recent runs. `GET /api/suppliers/:id/runs/current` the running one, for progress.
- Existing `POST /api/suppliers/:id/check-stock` now creates a manual run and returns 409 with a plain message if one is already running.

## Screens

- **Supplier edit page:** an "Automatic checks" panel: interval choice, next check time, and why checks are not running if the gate refuses.
- **Suppliers list:** a line per supplier: "Every 6 hours, next at 14:10" or "Automatic checks off", and progress while running.
- **Links page:** "Not checked recently" marker, last checked time.
- **Supplier runs:** a short history list.
- Plain words, same patterns as the existing screens, and the same accessibility scan.

## Project structure

- `packages/scheduling` pure logic: next-check time with spread, allowed intervals, backoff step, "which suppliers are due" given a list, stale test. No I/O, easy to test.
- `packages/db`: migration for `check_runs` and the new supplier columns, repository.
- `packages/queue`: job `scheduling.tick` (no data), run by the queue's own schedule.
- `apps/worker`: the tick handler, and the existing `extraction.checks` handler records the run row and honours the stop rules.
- `apps/api`: routes above.
- `apps/web`: the panels above.

## Commands

Same as today: `npm run check`, `npm run test:browser`, `npm run test:e2e`.

## Testing strategy

- Unit (Vitest, no I/O): next-check with spread stays within 10%; skipped suppliers do not move forward; backoff steps; stale rule; due selection with the concurrency limit; downtime catch-up runs once.
- Integration (real PostgreSQL in Testcontainers): tick starts a due supplier, skips one that fails the gate, refuses a second run while one is running (including two ticks at once); worker stop marks the run stopped; run counts match observations; 30-day cleanup.
- Fake supplier, fake clock: login expiry and captcha stop the run and are not retried; unreachable follows the backoff and a success resets it.
- End to end (Playwright, fake supplier): set an interval, see "next check", Check now shows progress and then the summary, a second Check now is refused with a plain message.
- No test visits a real supplier. A fake clock is used, so no test waits real hours.

## Boundaries

- **Always:** use the same gate and pause as manual checks; stop at once on login, puzzle or block; one run per supplier; keep run rows free of page content.
- **Ask first:** adding a dependency (for example a cron library); running more than the agreed number of suppliers at once; any retry of a puzzle or block.
- **Never:** check a supplier that is paused, not connected or not recorded as allowed; retry a captcha or block automatically; run on a schedule that the owner did not turn on; write to Shopify; propose anything.

## Success criteria

1. The owner can set an interval on a supplier, see the next check time, and turn it off.
2. A due supplier that passes the gate is checked by itself, once, and a run row shows its counts.
3. A supplier that is paused, not connected, not allowed or without active rules is never visited, and the screen says why.
4. Check now during a run is refused with a plain message; two ticks at once never start two runs for one supplier.
5. A login, puzzle or block stops the run at once and is never retried by the schedule. Unreachable follows 15 minutes, 1 hour, 4 hours, then the normal interval, and a success resets it.
6. After the app was down, a due supplier runs once, not once per missed slot. A restart during a run marks it stopped.
7. Progress ("12 of 40") shows during a run and the summary shows after it.
8. Links not checked for twice the interval show "Not checked recently".
9. No run row, log, audit event or job holds page content or session data. Runs older than 30 days are deleted.
10. `npm run check`, the browser tests and the browser journeys pass, including the accessibility scan of the new screens.

## Resolved questions (owner, 2026-11-10)

1. Default interval is **daily**, and the owner can change it in the app at any time (list: 1 hour, 3 hours, 6 hours, 12 hours, daily).
3. **At most 2 suppliers run at once** (recommended value, adopted).
5. Run history is kept **30 days**.
6. Built for all suppliers, **turned on for the pilot supplier only**, after its permission is recorded.

2. **Quiet hours:** each supplier has an allowed window, default **07:00 to 22:00** in the owner's timezone (recommended value, adopted). A check that falls due outside it waits until the window opens. The owner can change the window or set all day in the app.
4. **Login problem:** option A. Stop, notify on the Dashboard, wait for the owner. No automatic retry (captcha and block are never retried either).

## Still open for the owner

1. **Approve this version?** If anything is not what you want, say what to change.
