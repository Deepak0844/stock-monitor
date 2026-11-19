# Quick read: stock checks without the browser

Date: 2026-11-19. Status: draft, waiting for the owner's approval. Builds on `2026-11-19-built-in-stock-data-design.md`.

## Intent and the why

A stock check of a supplier that needs no login starts a full Chromium for every page: hundreds of MB of memory and about
4-5 s of CPU, even though the answer is one line of the page's HTML (`"availability": "InStock"`). The owner wants a lighter
server and more frequent checks on the small planned server (e2-medium, 4 GB). A plain download of the HTML was tested on one
supplier's product pages: HTTP 200 and the built-in availability present, the same answer the browser gave.

## Goals

- A **quick read**: the browser service downloads a page's HTML without Chromium and reads its built-in offers.
- For a supplier that needs no login, every stock check tries the quick read first and uses it only when it gives a clear
  answer; otherwise the same page gets today's full browser check. Automatic, no setting.
- Each answer records how it was read ("Read quickly" or "Read with the browser"), shown in the link's history.
- Automatic checks can run every **15** or **30** minutes, beside today's choices.

## Non-goals

- Quick reads for suppliers that need a login (they keep the browser and their session).
- Quick reads for captures (saved pages need the picture and the visible words).
- More runs at once (`MAX_RUNS_AT_ONCE` stays 2), a shorter pause between pages, or a new per-supplier setting.
- Quick link checks ("Check all links"): they stay on the browser.

## Anti-goals

- A supplier's site opened by anything but the browser service, or a private address reachable through the quick read.
- A wrong answer the browser would not have given. When in doubt, the browser decides.
- More traffic to a supplier: a page that falls back is fetched twice, so the quick read must stay small (HTML only, no
  pictures, scripts or styles).

## Constraints

- Public repository: no supplier names or domains.
- No new dependency for HTTP or HTML parsing: Node's own `https`/`http` and bounded regular expressions.
- The browser service API stays backwards compatible; the worker is the only caller.

## Approaches

1. **Quick read in the browser service, automatic fallback (chosen by the owner).** A new route next to `/capture`, through
   the same guard; the worker tries it first and falls back per page.
2. **Quick read in the worker.** Simpler, but the worker would open supplier sites and the private-address guard would have
   to be copied. Refused.
3. **As 1, with a per-supplier "Fast check" switch.** More control, one more setting; the fallback already makes 1 safe.

## Design

### 1. Browser service: `POST /quick-read`

Request: `{ url, publicPage: true }` (no session, no login address; `publicPage` must be true, anything else is refused).

What it does, all bounded:

- GET the address with Node's `https`/`http`. For each hop the host goes through `guard.check(host, port)` first; the
  connection goes to the address the guard returned (TLS `servername` = the host). A refused or private address stops the
  read with `result: "unknown"` and `blocked: true`, as a capture does.
- The same `Guard` instance the browser service already has (so tests reach a local server through `allowHosts`, as the
  capture's do). The quick read leaves directly from the service; a later proxy project must route it as well as Chromium.
- No page lock: a quick read is cheap and may run beside a capture.
- At most 5 redirects (each one guarded), 10 s in all (a slower site falls back to the browser), at most 3 MB of body (more: stop, `too_large`). `gzip`, `br` and
  `deflate` accepted and decoded. Headers: `accept: text/html`, an honest `user-agent` (`stock-monitor/1.0`), the
  `BROWSER_LANGUAGE` as `accept-language` when set. No cookies are sent or kept.
- Only `text/html` bodies are read.

What it returns (never the HTML):

```ts
type QuickReadOutcome =
  | { ok: true; result: PageClass; status: number | null; finalUrl: string | null; title: string | null; offers: PageOffer[]; signal: string }
  | { ok: false; reason: "failed" | "unavailable" };
```

- `offers`: from every `<script type="application/ld+json">` (each at most 1,000,000 characters) and every
  `itemprop="availability"` attribute, through **the same offer reader the capture uses**. The reader moves out of
  `describePage` into `services/browser/src/offers.ts` as a pure function `offersFrom(jsonTexts, microdata, pageUrl)`;
  `describePage` returns the raw script texts (each at most 1,000,000 characters, at most 2,000,000 in all) and microdata
  values, and the capture calls `offersFrom` in Node with the page's final address. The quick read passes its final address
  after redirects, so relative offer addresses resolve the same way. Same caps: 100 offers, 200 characters a field, 2000 values per script.
- `title`: the `<title>` text with entities decoded and spaces collapsed. No heading (see 3).
- `result` and `signal`: `explainPage` with `publicPage: true`, the HTML's visible-ish text (tags removed, scripts and styles
  dropped, capped like the capture's text), `hasPasswordField` from a visible `<input type=password>`, `hasChallengeWidget` from
  the known widget class names. Status 401/403/429/5xx map as today.

### 2. Worker: try quick, fall back per page

In `extraction-check.ts` `visit`, for a supplier with `needsLogin === false`, **stealth off** (a supplier the owner disguises
the browser for gets no plain, honestly named request), and a rules version (or the built-in default) that can be answered
from built-in data alone (built-in on, no page checks, no region rule):

1. `browser.quickRead({ url: mapping.url })`.
2. Use it when **all** hold: `ok`, `result === "ok"`, and `decide(page, recipe, region, link)` on a page with no sections and
   the quick read's offers gives `decidedBy: "built_in"`.
3. Otherwise run today's browser visit for this page. The answer and link status come from the browser visit only.

Word rules and quantity rules are never evaluated on a quick read (there are no sections), so a version with them falls back
whenever the built-in data does not answer. A version with page checks or a region rule never tries the quick read.

### 3. Link status from a quick read

`decideLinkStatus` gets an observation with `result`, `status`, `finalUrl`, `softNotFound` (from the HTML title, worked out in
the browser service), and **`title: null`, `heading: null`**. A script can rewrite a page's title in the browser, so the two
methods may read different titles; with neither given, a quick read never compares them, never makes a link "looks
different" and never sets `workedTitle`/`workedHeading` (they stay as the browser set them, or are filled by the next browser
visit). A missing page (404, a "not found" title) and a move to another site still count as today.

### 4. Storing how it was read

- Migration `0023`: `stock_observations.read_by text null` with check `read_by in ('quick', 'browser')`. Old rows stay null.
- Every observation of a page that was opened records `quick` or `browser`; one written without opening the page (a failed
  login before it, the browser service not answering) records null.
- Link history adds "· Read quickly" or "· Read with the browser".
- The worker log line `stock check finished` gains `readBy`, and a fallback logs its fixed reason code
  (`quick_read: fallback (<reason>)`, e.g. `blocked`, `no_offers`, `variant_unclear`, `not_ok`), never the page.

### 5. Every 15 or 30 minutes

- `INTERVALS` in `packages/scheduling` becomes `[15, 30, 60, 180, 360, 720, 1440]`; migration `0023` widens
  `suppliers_schedule_interval` to match.
- The Schedule card gains "Every 15 minutes" and "Every 30 minutes".
- Everything else follows from the interval as today (quiet hours, the ±10% spread, back-off, the next check set when a run
  ends, so runs never overlap; run expiry keeps its 15-minute floor). The early login check and keep-alive do not apply to
  no-login suppliers anyway.
- "Not checked recently" on Links is shown after `max(2 × interval, 2 hours)`, so a long run on a 15-minute schedule does not
  flag every link.
- **The pause between pages still applies after a quick read.** It is the owner's per-supplier politeness setting; a supplier
  that allows it can be given a shorter pause on its page. Shorter schedules and the lighter server are what this project adds.

## Testing

- `offers.ts`: the existing offer cases move to pure unit tests; the browser test keeps one end-to-end case.
- Quick read (unit, a local HTTP server): reads offers and title; follows a redirect and guards each hop; refuses a private
  address and a redirect to one; stops at 5 redirects, 3 MB and the time limit; decodes gzip and br; ignores non-HTML; a
  password box, a challenge widget, 401/403/429 classify as today; `publicPage` other than true is refused.
- Worker: quick answer used (one `/quick-read`, no `/capture`); fallback to `/capture` on not ok, blocked, no offers, unclear
  options, page checks present, region on; a supplier that needs a login never calls `/quick-read`; `read_by` stored.
- Scheduling: 15 and 30 accepted end to end; refused values still refused.
- Web: history wording; the two new schedule choices.

## Left to the builder

- The exact HTML text-stripping and title-decoding helpers, within the bounds above.
- Where in `extraction-check.ts` the "can be answered from built-in data alone" test lives.

## Calls made by Claude (owner to check)

- Quick reads send an honest `user-agent` (`stock-monitor/1.0`), not a browser's. A site that refuses it falls back to the
  browser.
- A page that falls back is downloaded twice (quick, then browser).
- No quick read when the rules use page checks or a region rule.
- Quick reads give link status no title or heading, so they never make a link "looks different"; the browser still does.
- No quick read for a supplier with stealth on.
- The pause between pages applies after quick reads too.
- Fallback after 10 s for a slow site (the owner asked what happens: the browser check then runs, with its own 20 s, and an
  unreachable page is "cannot tell", never out of stock).
