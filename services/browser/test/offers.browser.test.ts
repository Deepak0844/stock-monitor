// What readPage keeps from a page's built-in product data (schema.org JSON-LD and microdata): only the offers' four facts.
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readPage } from "../src/capture.js";

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
    return (await readPage(page)).offers;
  } finally {
    await page.close();
  }
}

describe("readPage: built-in offers", () => {
  it("reads a Product's offers and resolves a relative address", async () => {
    const offers = await offersOf(ld({ "@context": "https://schema.org", "@type": "Product", name: "Widget", offers: [{ "@type": "Offer", availability: "https://schema.org/InStock", url: "/products/widget?variant=1", sku: "A-1", name: "500 ml", price: "4.99" }] }));
    expect(offers).toEqual([{ availability: "InStock", url: "https://supplier.example/products/widget?variant=1", sku: "A-1", name: "500 ml" }]);
  });
  it("reads a single offer object", async () => {
    expect(await offersOf(ld({ "@type": "Product", offers: { "@type": "Offer", availability: "http://schema.org/OutOfStock" } }))).toEqual([{ availability: "OutOfStock", url: null, sku: null, name: null }]);
  });
  it("reads a ProductGroup's variants, taking the variant's name and address", async () => {
    const offers = await offersOf(ld({ "@type": "ProductGroup", hasVariant: [{ "@type": "Product", name: "Red", sku: "R-1", url: "/products/widget?variant=7", offers: { "@type": "Offer", availability: "OutOfStock" } }] }));
    expect(offers).toEqual([{ availability: "OutOfStock", url: "https://supplier.example/products/widget?variant=7", sku: "R-1", name: "Red" }]);
  });
  it("reads a Product inside @graph", async () => {
    expect(await offersOf(ld({ "@graph": [{ "@type": "BreadcrumbList" }, { "@type": ["Product"], offers: { availability: "SoldOut" } }] }))).toEqual([{ availability: "SoldOut", url: null, sku: null, name: null }]);
  });
  it("reads microdata", async () => {
    expect(await offersOf('<div itemscope itemtype="https://schema.org/Product"><link itemprop="availability" href="https://schema.org/SoldOut"></div>')).toEqual([{ availability: "SoldOut", url: null, sku: null, name: null }]);
  });
  it("skips broken JSON and keeps the valid script", async () => {
    expect(await offersOf(ld("{ not json") + ld({ "@type": "Product", offers: { availability: "InStock" } }))).toEqual([{ availability: "InStock", url: null, sku: null, name: null }]);
  });
  it("finds nothing on a page that is not a product", async () => {
    expect(await offersOf(ld({ "@type": "Article", headline: "News" }) + ld({ "@type": "BreadcrumbList", itemListElement: [] }))).toEqual([]);
  });
  it("finds nothing on a page with no built-in data", async () => {
    expect(await offersOf("<p>In stock</p>")).toEqual([]);
  });
  it("keeps at most 100 offers, each field at most 200 characters", async () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ availability: "InStock", sku: i === 0 ? "x".repeat(5000) : `S-${i}` }));
    const offers = await offersOf(ld({ "@type": "Product", offers: many }));
    expect(offers).toHaveLength(100);
    expect(offers[0]?.sku).toHaveLength(200);
  });
  it("keeps nothing else from the script", async () => {
    const offers = await offersOf(ld({ "@type": "Product", secretKey: "s3cret", offers: { availability: "InStock", seller: { name: "Someone" }, token: "t0ken" } }));
    expect(JSON.stringify(offers)).not.toMatch(/s3cret|t0ken|Someone/);
  });
});
