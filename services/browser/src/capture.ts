import { randomUUID } from "node:crypto";
import type { Browser, BrowserContextOptions } from "playwright";
import { explainPage, looksLikeNotFound, type SessionState } from "@stock-monitor/supplier-session";
import type { GuardProxy } from "./proxy.js";
import { CHALLENGE_WIDGET, MAX_TEXT, type BlockTracker, type CheckPageOutcome, type VerifyOptions } from "./verify.js";

export type CaptureRequest = { url: string; loginUrl?: string; state: SessionState; picture?: boolean };
/** What the browser was showing, as words: headings with the lines under them, and the buttons. Never raw HTML. */
export type PageSections = { heading: string | null; level: number; lines: string[] }[];
export type PageButtons = { label: string; enabled: boolean; section: string | null }[];
export type CaptureOutcome = CheckPageOutcome & { description: { sections: PageSections; buttons: PageButtons }; picture: string | null };
export type CaptureOptions = VerifyOptions & { proxy: GuardProxy };

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_FIELD = 200;
const LIMITS = { maxLines: 5000, maxLine: 2000, maxButtons: 500, maxBytes: 200_000 };
const MAX_PICTURE_BYTES = 1_000_000;
const short = (text: string | null | undefined) => (text ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_FIELD) || null;
const withoutQuery = (address: string): string | null => {
  try {
    const url = new URL(address);
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
};

/**
 * Runs inside the page. Reads only what the page is showing: the visible text (the browser leaves out hidden text, scripts and
 * styles, and writes a table row on one line with tabs between the cells), the headings, and the buttons. It never reads a field's
 * value, a cookie or a script. Inputs that could hold typed text are hidden before the text is read, so nothing typed can appear.
 * Everything is capped, so a huge or hostile page cannot make the answer huge.
 */
const describePage = (arg: { limits: typeof LIMITS; challenge: string }) => {
  const { limits, challenge } = arg;
  const shown = (el: Element) => (typeof (el as HTMLElement).checkVisibility === "function" ? (el as HTMLElement).checkVisibility() : el.getClientRects().length > 0);
  const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

  const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6,[role=heading]")]
    .filter(shown)
    .map((el) => ({
      el,
      level: /^H[1-6]$/.test(el.tagName) ? Number(el.tagName[1]) : Number(el.getAttribute("aria-level") ?? 2) || 2,
      text: ((el as HTMLElement).innerText ?? "").split("\n").map((l) => l.trim()).find((l) => l) ?? "",
    }))
    .filter((h) => h.text);

  const buttons: { label: string; enabled: boolean; section: string | null }[] = [];
  for (const el of document.querySelectorAll("button,[role=button],input[type=submit],input[type=button]")) {
    if (buttons.length >= limits.maxButtons) break;
    if (!shown(el)) continue;
    const input = el as HTMLInputElement;
    const label = oneLine((el as HTMLElement).innerText || (input.tagName === "INPUT" ? input.value : "") || el.getAttribute("aria-label") || "").slice(0, 200);
    if (!label) continue;
    let section: string | null = null;
    for (const h of headings) if (h.el.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) section = h.text;
    buttons.push({ label, enabled: !input.disabled && el.getAttribute("aria-disabled") !== "true", section });
  }

  const hasPasswordField = [...document.querySelectorAll('input[type="password"]')].some((el) => {
        // A sign-in popup that is hidden until someone clicks it is not a login wall.
        const box = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0.1;
      });
  const hasChallengeWidget = [...document.querySelectorAll(challenge)].some((el) => {
        // An invisible or off-screen widget (a form's spam guard) is not a puzzle in front of the page.
        const box = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return el.getAttribute("data-size") !== "invisible" && box.width >= 50 && box.height >= 30 && style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0.1 && box.bottom > 0 && box.right > 0;
      });
  for (const el of document.querySelectorAll("textarea,select,input:not([type=submit]):not([type=button])")) (el as HTMLElement).style.display = "none";

  const sections: { heading: string | null; level: number; lines: string[] }[] = [{ heading: null, level: 0, lines: [] }];
  let next = 0;
  let count = 0;
  let bytes = 0;
  const all = (document.body?.innerText ?? "").split("\n");
  for (const raw of all) {
    const line = raw.trim();
    if (!line) continue;
    const heading = headings[next];
    if (heading && line === heading.text) {
      sections.push({ heading: line, level: heading.level, lines: [] });
      next++;
      continue;
    }
    if (count >= limits.maxLines || bytes >= limits.maxBytes) continue;
    const kept = line.slice(0, limits.maxLine);
    (sections[sections.length - 1] as { lines: string[] }).lines.push(kept);
    count++;
    bytes += kept.length;
  }
  if (sections[0]?.lines.length === 0 && sections.length > 1) sections.shift();
  return {
    title: document.title,
    h1: headings.find((h) => h.level === 1)?.text ?? headings[0]?.text ?? "",
    text: all.join("\n").slice(0, 20_000),
    sections,
    buttons,
    hasPasswordField,
    hasChallengeWidget,
  };
};

// The container runs this file through tsx, which wraps named inner functions of describePage in __name(...). That helper does
// not exist inside the page, so the read would fail with "ReferenceError: __name is not defined". This gives the page one.
const NAME_SHIM = "globalThis.__name = globalThis.__name || ((fn) => fn)";

/** Reads what the page is showing. Exported so a test can run it under tsx, the way the container does. */
export async function readPage(page: import("playwright").Page) {
  await page.evaluate(NAME_SHIM);
  return page.evaluate(describePage, { limits: LIMITS, challenge: CHALLENGE_WIDGET });
}

// Whole page sharp, then whole page as a JPEG (long photo-heavy pages are far smaller that way), then only the visible part.
const PICTURE_TRIES = [
  { type: "png", fullPage: true },
  { type: "jpeg", quality: 80, fullPage: true },
  { type: "png", fullPage: false },
] as const;

/** Exported for a test. */
export async function takePicture(page: import("playwright").Page): Promise<string | null> {
  for (const options of PICTURE_TRIES) {
    try {
      const picture = await page.screenshot({ ...options, timeout: 10_000 });
      if (picture.length <= MAX_PICTURE_BYTES) return picture.toString("base64");
    } catch {
      // A page too big to draw: try the next way, then go without a picture.
    }
  }
  return null;
}

/**
 * Loads one page with a saved session and describes it, for the owner to write stock rules from and for the rules to run on.
 * Everything goes through the guard proxy, which refuses private addresses. Nothing is clicked, typed or scrolled.
 */
export async function capturePage(browser: Browser, request: CaptureRequest, options: CaptureOptions): Promise<CaptureOutcome> {
  const id = randomUUID();
  const tracker = options.proxy.track(id);
  const context = await browser.newContext({
    // The state is handed over as an object. It is never written to a file.
    storageState: request.state as BrowserContextOptions["storageState"],
    serviceWorkers: "block",
    acceptDownloads: false,
    proxy: { server: `http://127.0.0.1:${options.proxy.port}`, username: id, password: options.proxy.secret, bypass: "<-loopback>" },
  });
  try {
    return await capturePageIn(await context.newPage(), request, tracker, options.navigationTimeoutMs ?? DEFAULT_TIMEOUT_MS);
  } finally {
    tracker.stop();
    await context.close();
  }
}

/** Loads and describes the page in an already prepared page. Used with a throw-away context and with the persistent profile. */
export async function capturePageIn(page: import("playwright").Page, request: CaptureRequest, tracker: BlockTracker, timeoutMs: number): Promise<CaptureOutcome> {
  const nothing = { finalUrl: null, title: null, heading: null, softNotFound: false, description: { sections: [], buttons: [] }, picture: null };
  let status: number | null;
  try {
    const response = await page.goto(request.url, { timeout: timeoutMs, waitUntil: "load" });
    status = response?.status() ?? null;
    if (response?.headers()["x-guard-blocked"] === "private") return { result: "unknown", status, blockedRequests: tracker.blocked().count, ...nothing };
  } catch {
    const { count, privateAddress } = tracker.blocked();
    return { result: privateAddress ? "unknown" : "unreachable", status: null, blockedRequests: count, ...nothing };
  }

  // The picture first: describing the page hides its input fields.
  const picture = request.picture ? await takePicture(page) : null;
  const seen = await readPage(page);
  const { result, signal } = explainPage({
    requestedUrl: request.url,
    loginUrl: request.loginUrl,
    page: { finalUrl: page.url(), status, title: seen.title, text: seen.text.slice(0, MAX_TEXT), hasPasswordField: seen.hasPasswordField, hasChallengeWidget: seen.hasChallengeWidget },
  });
  const title = short(seen.title);
  const heading = short(seen.h1);
  return {
    result,
    status,
    blockedRequests: tracker.blocked().count,
    finalUrl: withoutQuery(page.url()),
    title,
    heading,
    softNotFound: looksLikeNotFound({ title, heading }),
    signal,
    description: { sections: seen.sections, buttons: seen.buttons },
    picture,
  };
}
