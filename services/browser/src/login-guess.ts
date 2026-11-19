import type { Frame, Locator, Page } from "playwright";

// What a login control says, when its wording is not on the exact lists in login.ts. A guess never takes a control that talks about
// something else (a newsletter, a sign-up, a social login, a log-out), however login-like its other words are.
export const LOGIN_WORDS = ["log in", "login", "sign in", "signin", "submit", "continue", "next", "enter", "go", "access", "your account"];
export const AVOID_WORDS = ["forgot", "reset", "register", "sign up", "signup", "create", "join", "guest", "show", "hide", "cancel", "back", "google", "facebook", "apple", "microsoft", "log out", "logout", "sign out"];

export const OPENER_WORDS = ["login", "log in", "sign in", "account"];

const source = (words: string[]) => `\\b(?:${words.join("|")})\\b`;
export const LOGIN_SOURCE = source(LOGIN_WORDS);
export const AVOID_SOURCE = source(AVOID_WORDS);
export const OPENER_SOURCE = source(OPENER_WORDS);
const login = new RegExp(LOGIN_SOURCE, "i");
const avoid = new RegExp(AVOID_SOURCE, "i");
const tidy = (text: string) => text.replace(/\s+/g, " ").trim();

/** Contains a login word and no avoid word, ignoring case and extra spacing. */
export const looksLikeLogin = (text: string): boolean => login.test(tidy(text)) && !avoid.test(tidy(text));
/** Contains an avoid word. */
export const isAvoided = (text: string): boolean => avoid.test(tidy(text));

/** The attribute that marks the control chosen, so it can be found again. One at a time per page. */
export const PICK_ATTR = "data-sm-pick";

/**
 * The control that submits the form `field` is in, found by what it says. Visible, enabled controls only: buttons, submit and
 * button inputs, and links that are styled or marked as buttons. The form is the field's own form, else the nearest container
 * (up to 4 levels) that holds such a control, so a newsletter box beside the login form is never looked at.
 * The one control that reads like a login wins (the first after the field if several), else the only button left. Else null.
 */
export async function guessSubmit(frame: Frame, field: Locator): Promise<Locator | null> {
  const picked = await field
    .evaluate(
      (el, o) => {
        const loginWords = new RegExp(o.login, "i");
        const avoidWords = new RegExp(o.avoid, "i");
        const textOf = (c: Element) => ((c as HTMLElement).innerText || (c as HTMLInputElement).value || c.getAttribute("aria-label") || c.getAttribute("title") || "").replace(/\s+/g, " ").trim();
        const usable = (c: Element) => {
          const box = c.getBoundingClientRect();
          const style = getComputedStyle(c);
          return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0.1 && !(c as HTMLButtonElement).disabled && c.getAttribute("aria-disabled") !== "true";
        };
        const isControl = (c: Element) => c.tagName !== "A" || c.getAttribute("role") === "button" || /btn|button/i.test(c.getAttribute("class") ?? "");
        const controlsIn = (root: Element) => [...root.querySelectorAll("button, input[type=submit], input[type=button], [role=button], a")].filter((c) => isControl(c) && usable(c) && textOf(c) !== "" && !avoidWords.test(textOf(c)));
        let root: Element | null = el.closest("form");
        if (!root) {
          root = el.parentElement;
          for (let up = 0; up < 4 && root && controlsIn(root).length === 0; up++) root = root.parentElement;
        }
        if (!root) return false;
        const all = controlsIn(root);
        const loginLike = all.filter((c) => loginWords.test(textOf(c)));
        const buttons = all.filter((c) => c.tagName === "BUTTON" || c.tagName === "INPUT");
        const after = loginLike.find((c) => el.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING) ?? loginLike[0];
        const pick = loginLike.length > 0 ? after : buttons.length === 1 ? buttons[0] : undefined;
        if (!pick) return false;
        for (const old of el.ownerDocument.querySelectorAll(`[${o.attr}]`)) old.removeAttribute(o.attr);
        pick.setAttribute(o.attr, "1");
        return true;
      },
      { login: LOGIN_SOURCE, avoid: AVOID_SOURCE, attr: PICK_ATTR },
    )
    .catch(() => false);
  return picked ? frame.locator(`[${PICK_ATTR}="1"]`) : null;
}

/**
 * The visible control that opens the login, found by what it says: a link, button or role=button whose words contain an opener word
 * and no avoid word (shortest first). A link with no words counts when its address contains login, signin or account.
 * Looks in every frame. Null when there is none, so a page with only "Log out" and "Register" is never clicked.
 */
export async function guessOpener(page: Page): Promise<Locator | null> {
  for (const frame of page.frames()) {
    const found = await frame
      .evaluate(
        (o) => {
          const opener = new RegExp(o.opener, "i");
          const avoidWords = new RegExp(o.avoid, "i");
          const textOf = (c: Element) => ((c as HTMLElement).innerText || c.getAttribute("aria-label") || c.getAttribute("title") || "").replace(/\s+/g, " ").trim();
          const usable = (c: Element) => {
            const box = c.getBoundingClientRect();
            const style = getComputedStyle(c);
            return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0.1 && c.getAttribute("aria-disabled") !== "true";
          };
          const ranked = [...document.querySelectorAll("a, button, [role=button]")]
            .filter(usable)
            .map((c) => ({ c, text: textOf(c) }))
            .filter(({ c, text }) => {
              if (text) return opener.test(text) && !avoidWords.test(text);
              // No words: the address has to say login, and not Register, Log out or anything else on the avoid list.
              const href = c.getAttribute("href") ?? "";
              return c.tagName === "A" && /login|sign-?in|account/i.test(href) && !avoidWords.test(href.replace(/[-_/.]+/g, " "));
            })
            .sort((a, b) => (a.text ? a.text.length : 1e6) - (b.text ? b.text.length : 1e6));
          const first = ranked[0];
          if (!first) return false;
          for (const old of document.querySelectorAll(`[${o.attr}]`)) old.removeAttribute(o.attr);
          first.c.setAttribute(o.attr, "1");
          return true;
        },
        { opener: OPENER_SOURCE, avoid: AVOID_SOURCE, attr: PICK_ATTR },
      )
      .catch(() => false);
    if (found) return frame.locator(`[${PICK_ATTR}="1"]`);
  }
  return null;
}
