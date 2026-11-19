// Run by consent.browser.test.ts under tsx, the way the container runs the service. For each page: hides the banner, then reads it.
import { chromium } from "playwright";
import { hideConsentBanners } from "../src/consent.js";
import { readPage } from "../src/capture.js";
import { PAGES } from "./consent-fixture.js";

const browser = await chromium.launch({ args: process.env.CI ? ["--no-sandbox"] : [] });
try {
  const out: Record<string, unknown> = {};
  for (const [name, html] of Object.entries(PAGES)) {
    const page = await browser.newPage();
    await page.setContent(html);
    await hideConsentBanners(page);
    const seen = await readPage(page);
    out[name] = { sections: seen.sections, buttons: seen.buttons };
    await page.close();
  }
  console.log(JSON.stringify(out));
} finally {
  await browser.close();
}
