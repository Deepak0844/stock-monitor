// Run by read-page.browser.test.ts under tsx, the way the container runs the service. Prints what readPage saw.
import { chromium } from "playwright";
import { readPage } from "../src/capture.js";
import { offersFrom } from "../src/offers.js";

const browser = await chromium.launch({ args: process.env.CI ? ["--no-sandbox"] : [] });
try {
  const page = await browser.newPage();
  await page.setContent(
    '<h1>Blue widget</h1><p>Out of stock</p><button disabled>Add to cart</button><script type="application/ld+json">{"@type":"Product","offers":{"availability":"https://schema.org/OutOfStock"}}</script>',
  );
  const seen = await readPage(page);
  console.log(JSON.stringify({ sections: seen.sections, buttons: seen.buttons, offers: offersFrom(seen.ldScripts, seen.microdata, page.url()) }));
} finally {
  await browser.close();
}
