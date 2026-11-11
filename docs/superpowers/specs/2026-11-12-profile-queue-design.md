# Profile-mode queue: captures must not stall

Small change. Status: draft, awaiting owner approval.

## Intent and why

`VERIFY_MODE=profile` is what gets past one supplier's bot check (headless gets 403 + CAPTCHA). It runs one headed Chromium at a
time, and every browser job shares one queue. A capture waited behind scheduled checks and open login windows, the worker gave up
after 30 s, and the service still ran the abandoned job, so the backlog grew. Result: "Could not capture, the browser service did not answer".

## Goals

- A capture or connection check starts as soon as the running job ends, even when scheduled checks are waiting.
- A job nobody is waiting for any more never runs.
- A full queue answers "busy" at once instead of hanging.
- Headless mode behaves exactly as today.

## Non-goals

- Running two browsers at once (the container limit is 2 GB, a profile browser takes about 900 MB).
- A per-supplier choice of mode, and background (polled) captures. Possible later.

## Approaches considered

A. Fix the queue (picked by the owner): priority, drop abandoned jobs, bounded queue. B. Profile mode per supplier only: a later
follow-up, does not fix the queue. C. Background captures: does not fix the stall. D. Two browsers: too much memory.

## Design

All in `services/browser/src/profile-check.ts` and `server.ts`, plus the client and one screen message.

1. **Two lanes.** `/capture` and `/verify` (a person is waiting) go before `/check-page` (scheduled link and stock checks). The
   service picks the lane from the route, so no request format changes. Within a lane, first come first served. The running job is never interrupted.
2. **Drop abandoned jobs.** The server notes when the caller's connection closes before the answer. A queued job whose caller is gone is
   skipped when its turn comes. A job already running finishes.
3. **Bounded queue.** At most 8 jobs wait in each lane, so scheduled checks never turn a person away. A ninth gets `503 {"error":"busy"}` straight away.
4. **Client.** `/capture` and `/verify` wait up to 90 s (the queue is short now). A 503 becomes the outcome `busy`.
   A capture that is busy is recorded as `browser_busy` and shown as "The browser is busy with other checks. Try again in a minute."
   Scheduled checks treat busy as "could not check", as they treat a timeout today.

## Constraints

- No change to headless mode, the login window, or the request and answer formats.
- Test first: unit tests for the queue (order, drop, limit), a server test for 503, client tests for busy and the 90 s limit.
- No supplier names or domains in the repo.

## Left to the builder

Exact queue limit and timeout values (8 and 90 s are my calls), file layout of the queue helper, wording of the screen message.
