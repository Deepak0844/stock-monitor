# Live Window Disguise Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A supplier's stealth switch makes its live login window report a real GPU and an ordinary Google Chrome identity.

**Architecture:** The plain live window loads a temporary built-in extension (`--load-extension`). The extension has a
main-world `document_start` content script in all frames and a `declarativeNetRequest` rule for `Sec-CH-UA`. The
stealth flag travels API, then browser client, then `POST /sessions`, then sessions, then the plain window opener.

**Tech Stack:** TypeScript, Node, Chromium (Chrome for Testing 158 via Playwright 1.65), vitest.

**Spec:** `docs/superpowers/specs/2026-11-18-live-window-disguise-design.md`

## Global Constraints

- Never write a supplier's name or domain in repo files.
- The live window never gets a debugging channel, except the existing test-only `exposePage`.
- Windows for suppliers with the switch off launch with exactly today's arguments.
- The page script is a plain `.js` file read at runtime, never `fn.toString()` of TS code.
- Commits: conventional type, no Claude attribution lines.

## Review Focus

- Stealth window on a kept (persistent) profile, then a later non-stealth check on the same profile: the extension must
  not stay loaded. Task 2 browser test: open the stealth window, then a non-stealth one on the same persistent dir, and
  expect the real SwiftShader renderer.
- The extension folder is removed when the window closes, also when the launch fails. Task 2 unit test on cleanup.
- `POST /sessions` with `stealth: "yes"` gets 400, and an unknown extra key still gets 400. Task 3 server tests.
- Controlled mode with stealth: the window still opens, plus one log line. Task 3 service test.
- `chrome --version` output that does not parse: the window opens without the disguise, and the service logs
  `disguise skipped: unknown browser version`. Task 1 unit test on `parseChromeVersion`.

---

### Task 1: Disguise extension builder

**Files:**
- Create: `services/browser/src/disguise.ts`, `services/browser/src/disguise-page.js`
- Test: `services/browser/src/disguise.test.ts`

**Interfaces:**
- Produces: `chromeBrands(full: string): { brand: string; version: string }[]` (full versions). Then
  `secChUa(full: string): string`, `parseChromeVersion(out: string): string | null`, and
  `writeDisguise(dir: string, full: string): Promise<void>`, which writes `manifest.json`, `rules.json` and `page.js`.
  Last, `chromeVersion(executable: string): Promise<string | null>`, cached per executable.

- [ ] Test: `chromeBrands("157.0.8103.79").map(b => b.brand)` equals `["Not-A.Brand","Google Chrome","Chromium"]`, and the grease version is `"99.0.0.0"`.
- [ ] Test: `secChUa("157.0.8103.79")` equals `"Not-A.Brand";v="99", "Google Chrome";v="157", "Chromium";v="157"` (real Chrome 157).
- [ ] Test: `secChUa("158.0.8127.18")` equals `"Chromium";v="158", "Not.A/Brand";v="24", "Google Chrome";v="158"`.
- [ ] Test: `parseChromeVersion("Google Chrome for Testing 158.0.8127.18\n")` gives `"158.0.8127.18"`, and `parseChromeVersion("garbage")` gives `null`.
- [ ] Test: `writeDisguise` writes a manifest with `world: "MAIN"`, `all_frames: true`, `match_origin_as_fallback: true` and `run_at: "document_start"`. Its `rules.json` sets `sec-ch-ua` to `secChUa(full)`. Its `page.js` starts with the brand JSON.
- [ ] Run `npx vitest run services/browser/src/disguise.test.ts`. Expect FAIL.
- [ ] Implement. `page.js` is the spike script. `writeDisguise` prepends `const FULL = <chromeBrands JSON>;` to it. It uses `globalThis.X` for browser globals so eslint's `no-undef` passes.
- [ ] Run the tests. Expect PASS. Then commit `feat(browser): build the live window disguise extension`.

### Task 2: Plain window loads it when asked

**Files:**
- Modify: `services/browser/src/plain-window.ts` (`plainLaunchArgs`, `createPlainWindowOpener`)
- Test: `services/browser/src/plain-window.test.ts`, `services/browser/test/disguise.browser.test.ts` (Linux only, as the other plain-window browser tests)

**Interfaces:**
- Consumes: Task 1 `writeDisguise`, `chromeVersion`.
- Produces: `plainLaunchArgs({... , extension?: string })` adds `--load-extension=<dir>` and `--disable-extensions-except=<dir>`. The opener's type becomes `(url: string, options?: { stealth?: boolean }) => Promise<PlainOpenedWindow>`. `PlainWindowOptions` gains `log?: (line: string) => void`.

- [ ] Unit test: with no `extension`, the args do not contain `--load-extension`, and with one they contain both flags.
- [ ] Browser test (exposePage, local http page with an iframe): with `stealth: true`, the main frame and the iframe both see the fake renderer, `brands` equal to `chromeBrands` (major only), and the `Sec-CH-UA` header equal to `secChUa`. With `stealth: false`, the renderer contains `SwiftShader`. On a persistent dir, a stealth window then a non-stealth one gives `SwiftShader` the second time. After `close()`, the extension folder is gone.
- [ ] Implement: `mkdtemp(join(tmpdir(), "sm-disguise-"))` and remove it in `cleanup`.
- [ ] Run unit tests, and run the browser test in `mcr.microsoft.com/playwright:v1.65.0-noble` under `xvfb-run`. Expect PASS. Then commit.

### Task 3: Carry the flag from the API to the window

**Files:**
- Modify: `services/browser/src/sessions.ts`, `services/browser/src/server.ts`, `services/browser/src/service.ts`, `packages/browser-client/src/client.ts`, `apps/api/src/routes/login-sessions.ts`
- Test: `services/browser/src/sessions.test.ts`, `services/browser/src/server.test.ts`, `packages/browser-client/src/client.test.ts`, and the API login-session test that fakes the browser

**Interfaces:**
- Produces: `OpenWindow = (url: string, options?: { stealth?: boolean }) => Promise<LiveWindow>`, `SessionsApi.open(url, options?)`, `BrowserClient.openSession(url: string, options?: { stealth?: boolean })`.

- [ ] Tests: sessions pass `{ stealth: true }` to `openWindow`. `POST /sessions` with `{url, stealth: true}` calls `open(url, {stealth: true})`; with `stealth: "yes"` it returns 400; with an extra key it returns 400. The client sends `stealth: true` only when it is on. The API passes `supplier.stealth`. In controlled mode, the service logs `stealth ignored: the live window needs LOGIN_WINDOW_MODE=plain`.
- [ ] Implement, run `npm run check`, and commit.

### Task 4: Words

**Files:** `apps/web/src/components/AutoLoginCard.tsx` (stealth hint), `docs/deployment.md` (one paragraph on what the disguise changes and its limits)

- [ ] Hint text: add "It also gives the live login window an ordinary graphics card and Chrome name." Update any test that matches the hint text.
- [ ] Run `npm run check` and commit.
