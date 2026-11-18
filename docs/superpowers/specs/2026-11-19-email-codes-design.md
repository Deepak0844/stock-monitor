# Email login codes

Status: draft for the owner, 2026-11-19. This is project 3 of `2026-11-18-robust-auto-login-roadmap.md`.

## Why

Some suppliers email a one-time code at every login, on any device. Automatic login stops there today with
`code_required`, so each of these suppliers needs a hand login on every run. The owner wants the app to read the code
from email and type it, so these suppliers log in with no hand step.

## What the owner said

- Codes come at every login, on any device.
- There are two kinds of login:
  - **Kind A:** username, then password, then code.
  - **Kind B:** username, then code, with no password.
- The owner does not know yet which suppliers do this, and has no example code email at hand. So the reader must be
  general, and it must log why it found no code, so the first real try can be tuned.
- The owner's existing email has a Gmail filter that forwards only the supplier code emails to the supplier-only Gmail
  (roadmap decision). The app reads only that Gmail, over IMAP, with an app password.

## Goals, non-goals and anti-goals

- **Goals:**
  - Kind A and kind B logins finish by themselves when the code email arrives within 3 minutes.
  - A code that does not come, or that the supplier refuses, ends the login as `code_required` today: the Dashboard
    notice, and the email alert from #165.
- **Non-goals:**
  - Magic links ("click here to sign in").
  - Codes sent by text message.
  - Codes in the live hand-login window: the owner types those.
  - Deleting or moving emails.
- **Anti-goals:**
  - The browser service holding the Gmail password.
  - A code or an email's text in any log, audit event, notice or database row.
  - Using a code from an earlier login.
  - Typing one supplier's code into another supplier's page.

## Approaches

1. **Chosen by the owner: the login pauses at the code box.** The browser answers "code needed" and keeps the page open.
   The worker reads the inbox, then sends the code in a second call.
2. **The browser service reads the inbox itself.** Rejected: the container that opens supplier websites would hold the
   Gmail password. Today it holds no secrets by design.
3. **The browser asks the worker for the code during the login.** Rejected: the worker has no address the browser can
   call. Adding one is a new open door for no gain.
4. **Log in again once the code arrives.** Rejected: most sites send a new code at every attempt.

## Design

### Browser service

- `POST /login` takes a new optional `codeWanted: true`. Without it, nothing changes.
- With it, when the login reaches a code box, the browser does not return `code_required`. It answers
  `{ result: "code_needed", holdId }` and keeps the page open, still holding the profile. The code box can appear in
  two places:
  - after the username step, with no password box (kind B);
  - after the password is submitted (kind A).
- A hold lasts at most 180 s. Then the page closes by itself and the profile is let go.
- `POST /login/:holdId/code { code }`:
  - Types the code into the code box (with the same per-box read-back used for the other boxes) and presses the
    submit button.
  - Then decides as after a password, and confirms on the check page as today.
  - Answers the final login outcome. A page that still shows the code box, or says the code is wrong or expired,
    gives `code_required`.
  - A code is accepted only once per hold.
- `POST /login/:holdId/cancel` closes the page and lets the profile go.
- An unknown or expired `holdId` gives 404.
- **One browser at a time (my call).** The browser service runs every check, verify, capture and login one at a time
  (`inTurn` in `profile-check.ts`), at about 900 MB each on a 4 GB server. A hold stays inside its turn. So while a code
  supplier waits for its email, other suppliers' checks wait too, for up to 3 minutes. That is usually seconds,
  because a code email mostly arrives fast. Two browsers at once would risk running out of memory. The two follow-up
  routes (`/code`, `/cancel`) act on the held page and do not queue behind the turn. The live hand-login window is
  separate and unchanged.
- **Which code boxes count.** It is the same rule as today: a visible one-time-code box.
  - A page that asks for a code with no box the login can find, such as a "check your email" text or a magic link,
    still returns `code_required` at once, with no hold.
  - **Boxes split one digit each (my call, in scope):** when the code box has a one-character limit and the boxes next
    to it are the same, one character goes into each box in order.
- **Time limits (my call).**
  - The login up to the code box keeps today's 150 s deadline.
  - The hold's 180 s counts from `code_needed`.
  - The `/code` call gets its own deadline of 120 s to type, submit and confirm, and the client waits up to 150 s for
    it.
  - The worker's own wait is 150 s, inside the 180 s hold.
- **Builder's call:** inside the service, `runLogin` can take an `awaitCode()` callback that the server layer turns
  into the two HTTP calls. Then the login stays one function.
- The code is never logged. The reason line can say `code_box=…`, `code_typed len=6` and the result, never the code.

### Worker

- **When it is used.** `ensureLoggedIn` sends `codeWanted: true` on every automatic login (start of a run, mid-run,
  Check login, Test login now, a keep-alive visit that has to log in) whenever the code reader is on. The code reader
  needs the alert Gmail settings below.
- **Failures count as today (my call).** A code that never comes, or one the supplier refuses, is `code_required`.
  As today, that counts as a failed automatic login, and 2 in a row pause automatic login (`too_many_failures`), with
  the notice and the email. This stops the app from asking a supplier for code after code when the email path is
  broken. **Resume** on the supplier page starts it again.
- **The wait.** On `code_needed`, the worker waits for the code, up to 150 s:
  - **Found:** it calls `/login/:holdId/code`. The final outcome is handled as any login result today.
  - **Not found:** it calls `/cancel`, and the result is `code_required`.
  - **Worker error:** it calls `/cancel` too, best effort.

### Code reader

**The inbox.**
- It connects to `imap.gmail.com` on port 993 over TLS, with `ALERT_EMAIL_FROM` and `ALERT_EMAIL_APP_PASSWORD` from
  #165. One Gmail app password works for both SMTP and IMAP. If those settings are not set, the code reader is off,
  and code suppliers stop as today.
- It opens the INBOX read-only, so the app never marks, moves or deletes an email.
- It looks every 5 s until a code is found or the time is up. It uses `imapflow`, and `mailparser` for the text.

**Which email counts.** It reads the inbox of `ALERT_EMAIL_FROM`, the supplier-only Gmail that the owner's filter
forwards to (roadmap decision). All three must hold:
- **Time:** Gmail's own arrival time (IMAP INTERNALDATE) is after the worker's clock at the moment it sent `/login`,
  minus 30 s for clock differences. The log line says how long after the login the email arrived. An email from an earlier login
  cannot be used, because that login started earlier. Newest first.
- **Sender:** its From domain is the supplier's website domain (the site part, so `mail.acme.co.uk` matches
  `www.acme.co.uk`). Gmail auto-forwarding keeps the original From. If a supplier sends from another domain, the new
  per-supplier field **Code email sender** (a domain or a full address) is used instead.
- **Code:** a code can be found in the subject or the plain text. Logins run one at a time, so two suppliers that share
  a sender domain never wait for a code at the same moment. If the email is HTML only, it is turned into text.

**Finding the code.**
- A code is 4 to 8 characters: digits, or capital letters and digits with at least one digit.
- The preferred one sits within about 60 characters after a word like code, verification, one-time, OTP, passcode,
  PIN or security.
- Failing that, an email with exactly one 6-digit number uses that number.
- Anything else is "no code". Then the next email is tried, and the time limit still applies.

**The log.** One line per wait, saying what happened, never the code or the text:
- `code: found from=acme.com waited=12s`
- `code: no_email waited=150s`
- `code: no_code_in_email from=acme.com`
- `code: sender_mismatch seen=other.com` (newest non-matching sender only)
- `code: imap_failed reason=EAUTH`

### Data, API and screen

- **Data.** Migration 0020 adds `suppliers.code_email_from text` (null means use the website's domain). A check keeps
  it short, at 254 characters or fewer.
- **API.** The supplier record returns `codeEmailFrom`. It is set where the logged-in marker is set (the "login page
  fields" route), and must be a domain or an email address.
- **Screen.** The Automatic login card gets an optional "Code email sender" box, with the hint "Only if the supplier's
  code emails come from a different address than its website. Example: login@mail.example.com".

### Docs

`docs/deployment.md`, Automatic login section, says:
- that code suppliers log in by themselves once email alerts are set up;
- how to set the Gmail filter in the owner's own email: forward only the supplier code emails to the supplier Gmail,
  and confirm the forwarding address (Gmail sends a confirmation code to the supplier Gmail);
- what the `code:` log lines mean;
- when to fill **Code email sender**.

## Left to the builder

- The file layout.
- The exact code-finding patterns, beyond the rules above.
- How the browser service holds the page.
- The test shapes. Example emails are made up in the tests, never real supplier emails.
