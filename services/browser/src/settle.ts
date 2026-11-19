import type { Page } from "playwright";
import { NAME_SHIM } from "./page-shim.js";

const SHOWN = 0.99;
const POLL_MS = 100;

/**
 * Waits, for at most `maxMs`, until the page's main heading is really shown: it and everything around it are no longer faded out.
 * Some shops load their page with the content at opacity 0 and fade it in a moment later, so a picture taken at once is blank
 * while the text (which is still there) reads fine. A page with no heading is not waited on. Returns false when the time ran out,
 * and the picture is taken anyway.
 */
export async function waitUntilShown(page: Page, maxMs = 4000): Promise<boolean> {
  try {
    await page.evaluate(NAME_SHIM);
    await page.waitForFunction(
      (shown) => {
        const heading = document.querySelector("h1");
        if (!heading) return true;
        for (let el: Element | null = heading; el; el = el.parentElement) if (Number(getComputedStyle(el).opacity) < shown) return false;
        return true;
      },
      SHOWN,
      { timeout: maxMs, polling: POLL_MS },
    );
    return true;
  } catch {
    return false;
  }
}
