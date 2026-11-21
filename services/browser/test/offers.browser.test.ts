// What readPage keeps from a page's built-in product data (schema.org JSON-LD and microdata): only the offers' four facts.
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readPage } from "../src/capture.js";
import { BOOKER_OUT_OF_STOCK } from "../src/booker-fixtures.js";
import { offersFrom } from "../src/offers.js";

const ADDRESS = "https://supplier.example/products/widget";
let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ args: process.env.CI ? ["--no-sandbox"] : [] });
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

const ld = (value: unknown) => `<script type="application/ld+json">${typeof value === "string" ? value : JSON.stringify(value)}</script>`;
async function offersOf(body: string) {
  const page = await browser.newPage();
  try {
    await page.route("https://supplier.example/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: `<html><body><h1>Widget</h1>${body}</body></html>` }));
    await page.goto(ADDRESS);
    const seen = await readPage(page);
    return offersFrom(seen.ldScripts, seen.microdata, page.url());
  } finally {
    await page.close();
  }
}

// The full set of reading cases is in src/offers.test.ts. These two prove the page hands the raw data over intact.
describe("readPage: built-in offers through a real page", () => {
  it("reads Booker's stock from the script that draws the product", async () => {
    expect(await offersOf(`<script type="module">${BOOKER_OUT_OF_STOCK}</script>`)).toEqual([{ availability: "outOfStock", url: null, sku: "302148", name: null }]);
  });
  it("reads a Product's offers and resolves a relative address against the page", async () => {
    const offers = await offersOf(ld({ "@type": "Product", offers: [{ availability: "https://schema.org/InStock", url: "/products/widget?variant=1", sku: "A-1", name: "500 ml" }] }));
    expect(offers).toEqual([{ availability: "InStock", url: "https://supplier.example/products/widget?variant=1", sku: "A-1", name: "500 ml" }]);
  });
  it("reads microdata and skips broken JSON", async () => {
    expect(await offersOf(ld("{ not json") + '<link itemprop="availability" href="https://schema.org/SoldOut">')).toEqual([{ availability: "SoldOut", url: null, sku: null, name: null }]);
  });
});
