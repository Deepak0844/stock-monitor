import { describe, expect, it } from "vitest";
import { BOOKER_IN_STOCK, BOOKER_OUT_OF_STOCK } from "./booker-fixtures.js";
import { offersFrom } from "./offers.js";

const PAGE = "https://supplier.example/products/widget";
const read = (...values: unknown[]) => offersFrom(values.map((v) => (typeof v === "string" ? v : JSON.stringify(v))), [], PAGE);

describe("offersFrom", () => {
  it("reads a Product's offers and resolves a relative address against the page", () => {
    expect(read({ "@context": "https://schema.org", "@type": "Product", name: "Widget", offers: [{ "@type": "Offer", availability: "https://schema.org/InStock", url: "/products/widget?variant=1", sku: "A-1", name: "500 ml", price: "4.99" }] })).toEqual([
      { availability: "InStock", url: "https://supplier.example/products/widget?variant=1", sku: "A-1", name: "500 ml" },
    ]);
  });
  it("reads a single offer object", () => {
    expect(read({ "@type": "Product", offers: { "@type": "Offer", availability: "http://schema.org/OutOfStock" } })).toEqual([{ availability: "OutOfStock", url: null, sku: null, name: null }]);
  });
  it("reads a ProductGroup's variants, taking the variant's name, SKU and address", () => {
    expect(read({ "@type": "ProductGroup", hasVariant: [{ "@type": "Product", name: "Red", sku: "R-1", url: "/products/widget?variant=7", offers: { "@type": "Offer", availability: "OutOfStock" } }] })).toEqual([
      { availability: "OutOfStock", url: "https://supplier.example/products/widget?variant=7", sku: "R-1", name: "Red" },
    ]);
  });
  it("reads a Product inside @graph", () => {
    expect(read({ "@graph": [{ "@type": "BreadcrumbList" }, { "@type": ["Product"], offers: { availability: "SoldOut" } }] })).toEqual([{ availability: "SoldOut", url: null, sku: null, name: null }]);
  });
  it("reads microdata values", () => {
    expect(offersFrom([], ["https://schema.org/SoldOut"], PAGE)).toEqual([{ availability: "SoldOut", url: null, sku: null, name: null }]);
  });
  it("skips broken JSON and keeps the valid script", () => {
    expect(read("{ not json", { "@type": "Product", offers: { availability: "InStock" } })).toEqual([{ availability: "InStock", url: null, sku: null, name: null }]);
  });
  it("finds nothing on data that is not a product", () => {
    expect(read({ "@type": "Article", headline: "News" }, { "@type": "BreadcrumbList", itemListElement: [] })).toEqual([]);
  });
  it("keeps at most 100 offers, each field at most 200 characters", () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ availability: "InStock", sku: i === 0 ? "x".repeat(5000) : `S-${i}` }));
    const offers = read({ "@type": "Product", offers: many });
    expect(offers).toHaveLength(100);
    expect(offers[0]?.sku).toHaveLength(200);
  });
  it("a huge first script does not use up the reading of a later product script", () => {
    const huge = { "@type": "WebSite", items: Array.from({ length: 3000 }, (_, i) => ({ n: i })) };
    expect(read(huge, { "@type": "Product", offers: { availability: "InStock" } })).toEqual([{ availability: "InStock", url: null, sku: null, name: null }]);
  });
  it("skips a script over a million characters, and still reads a later product script", () => {
    const giant = { "@type": "Product", offers: { availability: "OutOfStock" }, pad: "x".repeat(1_100_000) };
    expect(read(giant, { "@type": "Product", offers: { availability: "InStock" } })).toEqual([{ availability: "InStock", url: null, sku: null, name: null }]);
  });
  it("keeps nothing else from the script", () => {
    const offers = read({ "@type": "Product", secretKey: "s3cret", offers: { availability: "InStock", seller: { name: "Someone" }, token: "t0ken" } });
    expect(JSON.stringify(offers)).not.toMatch(/s3cret|t0ken|Someone/);
  });
});

describe("offersFrom: Booker's product script", () => {
  it("reads an in stock product, its SKU from sucode", () => expect(read(BOOKER_IN_STOCK)).toEqual([{ availability: "inStock", url: null, sku: "303983", name: null }]));
  it("reads an out of stock product", () => expect(read(BOOKER_OUT_OF_STOCK)).toEqual([{ availability: "outOfStock", url: null, sku: "302148", name: null }]));
  it("keeps an unknown status, for the checker to call unclear", () => expect(read(BOOKER_IN_STOCK.replace('"status":"inStock"', '"status":"lowStock"'))).toMatchObject([{ availability: "lowStock" }]));
  it("ignores a script with a stock status that does not draw the product", () =>
    expect(read(BOOKER_IN_STOCK.replaceAll("ProductDetailHero", "RelatedProducts"))).toEqual([]));
  it("finds nothing in the product script without a stock status", () => expect(read(BOOKER_IN_STOCK.replace('"availability":{"status"', '"availability":{"state"'))).toEqual([]));
  it("keeps both the product script and JSON-LD offers", () =>
    expect(read(BOOKER_OUT_OF_STOCK, { "@type": "Product", offers: { availability: "InStock" } })).toEqual([
      { availability: "outOfStock", url: null, sku: "302148", name: null },
      { availability: "InStock", url: null, sku: null, name: null },
    ]));
});
