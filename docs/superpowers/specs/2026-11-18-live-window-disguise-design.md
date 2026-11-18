# Live login window disguise (fake graphics card, ordinary Chrome identity)

Status: approved by the owner 2026-11-18.

## Why

One supplier's Shopify login shows a captcha in the live login window, and the captcha then fails even after the owner
solves it by hand. The same Chrome for Testing build on the owner's own Mac, on the same home connection, logs in with
no captcha at all. So the browser build is fine and the container is what gives it away. The clearest tell is the
graphics card: in the container, WebGL reports `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device ...), SwiftShader driver)`,
which is a software renderer that only servers have. The second tell is that the browser lists only `Chromium` as its
brand, both in `navigator.userAgentData` and in the `Sec-CH-UA` header. Ordinary Google Chrome also lists `Google Chrome`.

The owner reversed the earlier "never spoof" rule for this case.

## Goals

- When a supplier has the existing "Hide automation (stealth)" switch on, its live login window reports a real graphics
  card and an ordinary Google Chrome identity.
- The browser still claims to be a Linux PC. The OS, fonts, screen, language and timezone stay true, so nothing contradicts
  anything else.
- The live window keeps having no remote-control channel.

## Non-goals

- Background checks, the profile checker and the automatic login (the Patchright side) do not change.
- No fake for the pixels WebGL draws, for canvas, for workers, or for anything else in the fingerprint.
- No Windows or macOS identity.

## Anti-goals

- A disguise that contradicts itself: a brand order or a header that real Chrome of the same version would never send.
- Any change to how the window behaves for a supplier whose switch is off.

## Approaches considered

1. **A built-in extension loaded with `--load-extension` (chosen).** A content script runs in the page's own world at
   `document_start` in every frame, including captcha frames (`all_frames`, `match_origin_as_fallback`). A
   `declarativeNetRequest` rule sets `Sec-CH-UA`. There is no debugging channel, so the "plain window" promise holds.
   A spike in the running container (CfT 158) confirmed that the extension loads and that the fakes show in the page and
   in frames.
2. Inject the script over CDP. This would open the remote-control channel the plain window exists to avoid, and Chromium
   reports itself as automated while one is open. Rejected.
3. Give the container a real GPU. This costs more, is unproven, and still runs on a datacenter IP. Rejected.

## Design

- **Trigger.** `POST /api/suppliers/:id/login-session` passes the supplier's `stealth` flag to the browser client's
  `openSession(url, { stealth })`. The client sends `{ url, stealth: true }` to the browser service's `POST /sessions`
  only when the flag is on. The service accepts an optional boolean `stealth` key there. In `LOGIN_WINDOW_MODE=plain` the
  window gets the disguise. In `controlled` mode the flag is ignored and the service logs
  `stealth ignored: the live window needs LOGIN_WINDOW_MODE=plain`.
- **Graphics card.** For `UNMASKED_VENDOR_WEBGL` (37445), `WebGLRenderingContext`/`WebGL2RenderingContext`
  `getParameter` returns `Google Inc. (Intel)`. For `UNMASKED_RENDERER_WEBGL` (37446) it returns
  `ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6)`. Every other parameter goes to the real function.
- **Identity.** The brand list is the one real Google Chrome of the running version sends. It is built from Chromium's
  GREASE rule, seeded by the major version:
  - The fake brand is `Not` + c[m % 11] + `A` + c[(m+1) % 11] + `Brand`, where c = `[" ", "(", ":", "-", ".", "/", ")", ";", "=", "?", "_"]`.
  - Its version is `["8", "99", "24"][m % 3]`.
  - The list `[grease, Chromium, Google Chrome]` is placed by the permutation `orders[m % 6]`, where orders is
    `[[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]]` and `out[order[i]] = list[i]`.
  - Checked against a real Chrome 157 (`"Not-A.Brand";v="99", "Google Chrome";v="157", "Chromium";v="157"`) and
    against CfT 158's own two-brand list.
  - The same list feeds `navigator.userAgentData.brands`, `toJSON()`, and `getHighEntropyValues` `brands` and
    `fullVersionList` (full versions: grease `<v>.0.0.0`, the other two the real full version). It also feeds the
    `Sec-CH-UA` header (`"<brand>";v="<major>"` joined by `, `).
- **Version.** Read once per service from `<chromium executable> --version`.
- **Looks native.** Every replaced function, and `Function.prototype.toString` itself, prints
  `function <name>() { [native code] }`.
- **Files.** A temporary extension folder per window holds `manifest.json`, `rules.json` and `page.js`. It is removed
  when the window closes. The page script is a plain `.js` file read at runtime, never a serialised TS function: tsx
  wraps those in `__name`, which broke page scripts before.
- **UI.** The stealth hint in the Automatic login card says that the switch also disguises the live login window.

## Known limits

- WebGL output pixels are still SwiftShader's.
- A determined script can spot the proxies.
- Workers are not covered.
- `Sec-CH-UA-Full-Version-List` is not rewritten when a site asks for it.
- Whether the captcha then passes is unproven until the owner tries it live.

## Left to the builder

File layout inside `services/browser/src`, test shapes, and the docs wording.
