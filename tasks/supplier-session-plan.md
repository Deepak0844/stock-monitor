# Implementation Plan: supplier-session

Spec: `SPEC-supplier-session.md` (approved 2026-11-08). Map: `CAPABILITY-MAP.md`. Tasks: `tasks/supplier-session-todo.md`.
The Shopify plan stays in `tasks/plan.md` and `tasks/todo.md` because its Task 11 (the real-store check) is still open. This module has its own files so nothing unfinished is overwritten.

## Overview
Add suppliers, and let the owner connect each one by logging in by hand through a live browser window that runs in an isolated container on the server and is shown inside the owner's own browser tab. Save the logged-in session encrypted and separate per supplier. Detect when a session expires, hits a CAPTCHA or is blocked, pause only that supplier, tell the owner, and offer **Reconnect supplier**.

## Defaults used for the owner's open questions
The five spec questions are unanswered, so these apply: pilot on the owner's Mac with Docker, the owner connects suppliers from a desktop browser, one shared account per supplier. **Task 14, the real pilot supplier, cannot start until the owner names the supplier and has checked its terms.** Tasks 1 to 13 need nothing from the owner.

## Architecture decisions
- **Spike first, as a real decision gate.** The documentation does not cover a visible Chromium in Docker, so Task 1 proves the whole chain before anything depends on it. If it fails, the design changes before any real code exists.
- **Pure logic in `packages/supplier-session`:** the page classifier, token manager, sealing and supplier validation have no browser code, so they are unit tested on saved fixtures.
- **All browser activity in `services/browser`:** its own image (the official Playwright image, pinned), a non-root user, a seccomp profile, no published ports, and no database access or encryption key.
- **A fake supplier website** (test helper) exists before anything real is touched. No automated test visits a real supplier.
- **Authentication is our code:** the live-window WebSocket needs the signed-in owner, an allowed origin and a one-time token (256 bits, hashed, 10 minutes, single use).
- **Session state never touches disk in plain form.** It is sealed with the existing `crypto` package and handed to the browser in memory.
- **Vertical slices, risk first.** The spike, then the pure logic, then the browser service, then the API and security, then the screens, then the whole stack.

## Dependency graph
```
1 spike (decision gate)
 ├─ 2 supplier validation + suppliers table + API
 │   └─ 3 Suppliers screens
 ├─ 4 page classifier + session sealing (pure)
 ├─ 5 fake supplier website
 │   └─ 6 browser service: headless verify (needs 4, 5)
 │       └─ 7 browser service: interactive session (needs 1, 6)
 │           └─ 8 login sessions, token manager, sealed storage, routes (needs 2, 4, 7)
 │               └─ 9 WebSocket proxy and its security tests (needs 8)
 │                   └─ 11 Connect screen and dashboard card (needs 3, 9, 10)
 └─ 10 session check job, statuses, pauses, notifications (needs 2, 4, 6, 8)
12 compose integration (needs 7, 9)
13 browser tests through the stack, accessibility (needs 11, 12)
14 pilot supplier with the owner (needs 13 and the owner)
```

## Task list
See `tasks/supplier-session-todo.md`. Checkpoints after Tasks 1 (the spike decision), 9 (security) and 13 (everything).

## Risks and mitigations
| Risk | Impact | Mitigation |
|---|---|---|
| A visible Chromium does not work well in Docker on the owner's Mac (display, input, performance) | High | Task 1 proves it first. Fall back to KasmVNC, or to a different capture approach, before building. |
| The pilot supplier blocks or challenges automated or datacentre traffic | High | Sessions are created by a human and checks are gentle. A blocked state is a first-class result. Tasks 1 and 14 show it early. |
| A site keeps its login in session storage, which Playwright cannot save | Medium | Detected at connect time ("session check failed right after login"), reported plainly, handled per supplier later. |
| The content security policy blocks the live window's WebSocket | Medium | Tested in the spike and again in the browser tests. Widened only as far as needed. |
| The classifier calls a page `ok` when it is not | High | It says `unknown` when unsure. Built from real saved pages, with a test that ambiguous pages never become `ok`. |
| The browser container could reach internal services (SSRF) | High | Separate network, no secrets in the container, and a block on private, loopback and metadata addresses including after redirects. Tested. |
| Chromium vulnerability from a supplier page | Medium | Pinned image, non-root, seccomp, memory limits, no host mounts, throw-away profile. Updated deliberately. |
| Typing or clipboard through the remote window is awkward for passwords | Medium | A "Paste text" box. Verified by the owner in the spike and the pilot. |
| Real human interaction cannot be automated | Medium | A test-only hook logs in inside the remote window for the browser tests. The owner verifies the real feel in the spike and the pilot. |

## Open questions
The five questions at the end of the spec. None blocks Tasks 1 to 13.
