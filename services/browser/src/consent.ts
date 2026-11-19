import type { Page } from "playwright";
import { NAME_SHIM } from "./page-shim.js";

/** The cookie consent tools that most shops use, by the id or class they give their banner. */
const KNOWN_BANNERS = [
  "#CybotCookiebotDialog", "#CybotCookiebotDialogBodyUnderlay", "#onetrust-consent-sdk", "#didomi-host", "#usercentrics-root",
  "#cmpbox", "#cmpwrapper", "#cmplz-cookiebanner-container", "#cookie-law-info-bar", "#CookieConsent", ".cc-window", ".qc-cmp2-container", "#truste-consent-track",
].join(",");

/**
 * Hides cookie consent banners before a page is photographed and read, so the picture shows the product and the banner's words and
 * buttons are not mistaken for the page's own (they would be on every page, and gone once the supplier remembers the choice).
 * Nothing is clicked and no choice is made for the owner: the banner is only hidden in this one visit. A banner is a known tool's
 * (by id or class), or any fixed or dialog box that talks about cookies or consent, has a button and no main heading, so a shop that
 * sells cookies keeps its own page. Returns how many were hidden. A page that will not run the script is read as it is.
 */
export async function hideConsentBanners(page: Page): Promise<number> {
  try {
    await page.evaluate(NAME_SHIM);
    return await page.evaluate((known) => {
      const hide = (el: Element) => (el as HTMLElement).style.setProperty("display", "none", "important");
      const shown = (el: Element) => (el as HTMLElement).getClientRects().length > 0;
      const talksAboutCookies = /\bcookies?\b|\bconsent\b|\bgdpr\b/i;
      let hidden = 0;
      for (const el of document.querySelectorAll(known)) {
        if (!shown(el)) continue;
        hide(el);
        hidden++;
      }
      for (const el of document.querySelectorAll("div,section,aside,form,dialog,[role=dialog],[role=alertdialog]")) {
        if (!shown(el)) continue;
        const style = getComputedStyle(el);
        const floating = style.position === "fixed" || style.position === "sticky" || el.getAttribute("role") === "dialog" || el.getAttribute("aria-modal") === "true";
        const text = (el as HTMLElement).innerText ?? "";
        if (!floating || text.length > 4000 || !talksAboutCookies.test(text)) continue;
        if (el.querySelector("h1") || !el.querySelector("button,[role=button],input[type=button],input[type=submit]")) continue;
        hide(el);
        hidden++;
      }
      return hidden;
    }, KNOWN_BANNERS);
  } catch {
    return 0;
  }
}
