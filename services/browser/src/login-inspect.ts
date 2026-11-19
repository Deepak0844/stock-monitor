// "Check login page": what a login would use on a supplier's login page, and every other control the owner could pick instead.
// Nothing is typed and nothing is sent. The one thing it may click is the control that opens the login, once.
import type { Frame, Locator, Page } from "playwright";
import type { LoginSelectors } from "@stock-monitor/supplier-session";
import { AVOID_SOURCE, LOGIN_SOURCE, OPENER_SOURCE } from "./login-guess.js";
import { challengeVisible, findFields, findOpener, nextButton, type Found } from "./login.js";
import { NAME_SHIM } from "./page-shim.js";

export type InspectControl = { label: string; selector: string };
export type LoginInspection = {
  state: "form" | "opener" | "none" | "captcha" | "unreachable";
  /** The opener was clicked to show the form. */
  opened: boolean;
  found: Record<"open" | "account" | "username" | "password" | "submit", InspectControl | null>;
  fields: InspectControl[];
  buttons: InspectControl[];
};
export type InspectRequest = { loginUrl: string; checkUrl: string; stealth: boolean; selectors?: LoginSelectors };

const MAX_LABEL = 60;
const MAX_SELECTOR = 200;
const MAX_LIST = 40;
const CAND = "data-sm-cand";
const DESC = "data-sm-desc";
// An id a person wrote (UserName, customer-email), not one a script made (ember123, a1b2c3d4e5f6): safe to save for next time.
const STABLE = "^(?!.*\\d{3})(?![a-f0-9]{8,}$)[A-Za-z][A-Za-z0-9_-]{0,59}$";
export const stableId = (id: string): boolean => new RegExp(STABLE, "i").test(id);

/** A selector that finds exactly one visible control, and it is the marked one. */
async function unique(frame: Frame, selector: string): Promise<boolean> {
  try {
    const visible = frame.locator(selector).filter({ visible: true });
    return (await visible.count()) === 1 && (await visible.and(frame.locator(`[${DESC}]`)).count()) === 1;
  } catch {
    return false;
  }
}

/** A control as the owner sees it: its own short words, and a selector that finds only it. Null when it cannot get one. */
async function describeControl(locator: Locator): Promise<InspectControl | null> {
  const handle = await locator.elementHandle({ timeout: 2000 }).catch(() => null);
  const frame = await handle?.ownerFrame().catch(() => null);
  if (!handle || !frame) return null;
  const info = await handle
    .evaluate(
      (el, o) => {
        for (const old of el.ownerDocument.querySelectorAll(`[${o.desc}]`)) old.removeAttribute(o.desc);
        el.setAttribute(o.desc, "1");
        const clean = (t: string | null | undefined) => (t ?? "").replace(/\s+/g, " ").trim();
        const quote = (v: string) => v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        const input = el as HTMLInputElement;
        const tag = el.tagName.toLowerCase();
        const type = (input.type ?? "").toLowerCase();
        const box = tag === "input" && !["submit", "button", "image", "reset"].includes(type);
        const own = clean((el as HTMLElement).innerText) || clean(input.value) || clean(el.getAttribute("aria-label")) || clean(el.getAttribute("title"));
        const label = box ? clean(input.labels?.[0]?.innerText) || clean(el.getAttribute("aria-label")) || clean(input.placeholder) || clean(input.name) || clean(input.id) || type : own || clean(el.id);
        const candidates: string[] = [];
        if (el.id && new RegExp(o.stable, "i").test(el.id)) candidates.push(`#${CSS.escape(el.id)}`);
        if (box) {
          if (input.name) candidates.push(`input[name="${quote(input.name)}"]`);
          if (input.placeholder) candidates.push(`input[placeholder="${quote(input.placeholder)}"]`);
          if (el.getAttribute("aria-label")) candidates.push(`input[aria-label="${quote(el.getAttribute("aria-label") as string)}"]`);
        } else {
          if (tag === "input" && input.value) candidates.push(`input[type="${type}"][value="${quote(input.value)}"]`);
          const words = clean(el.textContent);
          if (tag !== "input" && words && words.length <= 60) candidates.push(`${tag}:text-is("${quote(words)}")`);
          if (tag === "a" && el.getAttribute("href")) candidates.push(`a[href="${quote(el.getAttribute("href") as string)}"]`);
        }
        return { label: label.slice(0, o.maxLabel), candidates };
      },
      { desc: DESC, stable: STABLE, maxLabel: MAX_LABEL },
    )
    .catch(() => null);
  if (!info || !info.label) return null;
  for (const selector of info.candidates) if (selector.length <= MAX_SELECTOR && (await unique(frame, selector))) return { label: info.label, selector };
  return null;
}

/** Marks the visible boxes (fields) or clickable controls (buttons) of a frame and returns how many, most login-like first. */
async function markCandidates(frame: Frame, kind: "fields" | "buttons"): Promise<number> {
  return frame
    .evaluate(
      (o) => {
        const clean = (t: string | null | undefined) => (t ?? "").replace(/\s+/g, " ").trim();
        const usable = (c: Element) => {
          const box = c.getBoundingClientRect();
          const style = getComputedStyle(c);
          return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0.1 && !(c as HTMLInputElement).disabled && c.getAttribute("aria-disabled") !== "true";
        };
        for (const old of document.querySelectorAll(`[${o.cand}]`)) old.removeAttribute(o.cand);
        const login = new RegExp(`${o.login}|${o.opener}`, "i");
        const avoid = new RegExp(o.avoid, "i");
        const textOf = (c: Element) => clean((c as HTMLElement).innerText) || clean((c as HTMLInputElement).value) || clean(c.getAttribute("aria-label")) || clean(c.getAttribute("title"));
        let list: Element[];
        if (o.kind === "fields") {
          list = [...document.querySelectorAll("input")].filter((i) => ["text", "email", "tel", "number", "password"].includes((i.type || "text").toLowerCase()) && !i.readOnly && usable(i));
        } else {
          const seen = new Set<string>();
          list = [...document.querySelectorAll("button, input[type=submit], input[type=button], [role=button], a")]
            .filter((c) => usable(c) && (textOf(c) !== "" || (c.tagName === "A" && c.getAttribute("href"))))
            .map((c) => ({ c, rank: avoid.test(textOf(c)) ? 2 : login.test(textOf(c)) ? 0 : 1 }))
            .sort((a, b) => a.rank - b.rank)
            .map(({ c }) => c)
            .filter((c) => {
              const key = `${c.tagName}|${textOf(c)}`;
              return seen.has(key) ? false : (seen.add(key), true);
            });
        }
        list.slice(0, o.max).forEach((c, i) => c.setAttribute(o.cand, String(i)));
        return Math.min(list.length, o.max);
      },
      { kind, cand: CAND, max: MAX_LIST, login: LOGIN_SOURCE, opener: OPENER_SOURCE, avoid: AVOID_SOURCE },
    )
    .catch(() => 0);
}

/** Every visible candidate on the page, in every frame, as controls with their own unique selectors. */
async function candidates(page: Page, kind: "fields" | "buttons"): Promise<InspectControl[]> {
  const out: InspectControl[] = [];
  for (const frame of page.frames()) {
    const count = await markCandidates(frame, kind);
    for (let i = 0; i < count && out.length < MAX_LIST; i++) {
      const control = await describeControl(frame.locator(`[${CAND}="${i}"]`));
      if (control && !out.some((c) => c.selector === control.selector)) out.push(control);
    }
  }
  return out;
}

const merge = (first: InspectControl[], second: InspectControl[]) => [...first, ...second.filter((c) => !first.some((f) => f.selector === c.selector))].slice(0, MAX_LIST);
const anyBox = (f: Awaited<ReturnType<typeof findFields>>) => !!(f.username || f.password || f.account);

/**
 * Loads the login page and reports what a login would use for each role (the same guessing the login does), plus every other
 * visible box and control. When no box is visible and an opener is found, clicks it once and looks again. Types nothing, sends nothing.
 */
export async function inspectLogin(page: Page, request: InspectRequest, { formWaitMs = 10_000, stepWaitMs = 10_000 }: { formWaitMs?: number; stepWaitMs?: number } = {}): Promise<LoginInspection> {
  const selectors = request.selectors ?? {};
  const result = (state: LoginInspection["state"], rest: Partial<LoginInspection> = {}): LoginInspection => ({
    state, opened: false, found: { open: null, account: null, username: null, password: null, submit: null }, fields: [], buttons: [], ...rest,
  });
  await page.addInitScript(NAME_SHIM).catch(() => {});
  let status: number | null = null;
  try {
    status = (await page.goto(request.loginUrl, { timeout: 20_000, waitUntil: "load" }))?.status() ?? null;
  } catch {
    // no answer at all
  }
  if (status === null || status >= 500 || status === 429) return result("unreachable");
  await page.waitForLoadState("load", { timeout: 5000 }).catch(() => {});
  if (await challengeVisible(page)) return result("captcha");

  /** Waits until a box or an opener shows, or the time is up. */
  const waitForBoxes = async (ms: number, withOpener: boolean): Promise<Found | null> => {
    const end = Date.now() + ms;
    for (;;) {
      if (anyBox(await findFields(page, selectors))) return null;
      if (withOpener && (await findOpener(page, selectors.open))) return null;
      if (Date.now() >= end) return null;
      await page.waitForTimeout(250);
    }
  };
  await waitForBoxes(formWaitMs, true);

  const before = { fields: await candidates(page, "fields"), buttons: await candidates(page, "buttons") };
  let fields = await findFields(page, selectors);
  let open: InspectControl | null = null;
  let opened = false;
  if (!anyBox(fields)) {
    const opener = await findOpener(page, selectors.open);
    if (!opener) return result("none", before);
    open = await describeControl(opener);
    opened = true;
    await opener.click({ timeout: 3000, noWaitAfter: true }).catch(() => {});
    await waitForBoxes(stepWaitMs, false);
    fields = await findFields(page, selectors);
    if (!anyBox(fields)) return result("opener", { opened, found: { ...result("opener").found, open }, fields: before.fields, buttons: before.buttons });
  }

  const last = (fields.password ?? fields.username ?? fields.account) as NonNullable<Found>;
  const next = await nextButton(page, last.frame, last.field, selectors.submit).catch(() => null);
  const found = {
    open,
    account: fields.account ? await describeControl(fields.account.field) : null,
    username: fields.username ? await describeControl(fields.username.field) : null,
    password: fields.password ? await describeControl(fields.password.field) : null,
    submit: next && next !== "missing" ? await describeControl(next) : null,
  };
  return {
    state: "form",
    opened,
    found,
    fields: merge(before.fields, await candidates(page, "fields")),
    buttons: merge(before.buttons, await candidates(page, "buttons")),
  };
}
