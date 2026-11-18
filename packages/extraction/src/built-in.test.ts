import { describe, expect, it } from "vitest";
import { availabilityAnswer, availabilityName, pickOffer, type LinkRef, type Offer } from "./built-in.js";

describe("availabilityName", () => {
  it.each([
    ["https://schema.org/InStock", "InStock"],
    ["http://schema.org/OutOfStock", "OutOfStock"],
    ["schema:SoldOut", "SoldOut"],
    [" PreOrder ", "PreOrder"],
  ])("%s is %s", (raw, name) => expect(availabilityName(raw)).toBe(name));
});

describe("availabilityAnswer", () => {
  it.each(["InStock", "LimitedAvailability", "OnlineOnly"])("%s is in stock", (v) => expect(availabilityAnswer(v, "out_of_stock")).toBe("in_stock"));
  it.each(["OutOfStock", "SoldOut", "Discontinued"])("%s is out of stock", (v) => expect(availabilityAnswer(v, "in_stock")).toBe("out_of_stock"));
  it.each(["PreOrder", "PreSale", "BackOrder", "MadeToOrder"])("%s follows the waiting choice", (v) => {
    expect(availabilityAnswer(v, "out_of_stock")).toBe("out_of_stock");
    expect(availabilityAnswer(v, "in_stock")).toBe("in_stock");
    expect(availabilityAnswer(v, "cannot_tell")).toBeNull();
  });
  it.each(["InStoreOnly", "Reserved", "Whatever", ""])("%s is not clear", (v) => expect(availabilityAnswer(v, "out_of_stock")).toBeNull());
  it.each(["https://schema.org/InStock", "http://schema.org/InStock", "schema:InStock", "instock", " InStock "])("%s reads as InStock", (v) =>
    expect(availabilityAnswer(v, "out_of_stock")).toBe("in_stock"),
  );
});

const offer = (availability: string, extra: Partial<Offer> = {}): Offer => ({ availability, url: null, sku: null, name: null, ...extra });
const noLink: LinkRef = { url: null, option: null };

describe("pickOffer", () => {
  it("no offers is no data", () => expect(pickOffer([], noLink, "out_of_stock")).toBeNull());
  it("one offer answers", () => expect(pickOffer([offer("InStock")], noLink, "out_of_stock")).toMatchObject({ answer: "in_stock" }));
  it("offers that agree answer", () => expect(pickOffer([offer("OutOfStock"), offer("SoldOut")], noLink, "in_stock")).toMatchObject({ answer: "out_of_stock" }));
  it("one unclear offer is built_in_unclear", () => expect(pickOffer([offer("Reserved")], noLink, "out_of_stock")).toEqual({ unclear: "built_in_unclear" }));

  const two = [
    offer("InStock", { url: "https://supplier.example/products/w?variant=1", sku: "A-1", name: "500 ml" }),
    offer("OutOfStock", { url: "/products/w/?variant=2", sku: "A-2", name: "1 L" }),
  ];
  it("matches the link's variant value, host and trailing slash ignored", () =>
    expect(pickOffer(two, { url: "https://other.example/products/w?variant=2&x=1", option: null }, "in_stock")).toMatchObject({ answer: "out_of_stock" }));
  it("offers of another product are no data for this link, even with the same variant value", () =>
    expect(pickOffer(two, { url: "https://supplier.example/products/other?variant=2", option: null }, "in_stock")).toBeNull());
  it("matches the link's option by sku", () => expect(pickOffer(two, { url: "https://supplier.example/products/w", option: "a-1" }, "out_of_stock")).toMatchObject({ answer: "in_stock" }));
  it("matches the link's option by name", () => expect(pickOffer(two, { url: null, option: "1 l" }, "in_stock")).toMatchObject({ answer: "out_of_stock" }));
  it("no match is variant_unclear", () => expect(pickOffer(two, { url: "https://supplier.example/products/w", option: "2 L" }, "in_stock")).toEqual({ unclear: "variant_unclear" }));
  it("two offers matching one option is variant_unclear", () =>
    expect(pickOffer([offer("InStock", { name: "Red" }), offer("OutOfStock", { name: "Red" })], { url: null, option: "Red" }, "in_stock")).toEqual({ unclear: "variant_unclear" }));
  it("no link is variant_unclear", () => expect(pickOffer(two, noLink, "in_stock")).toEqual({ unclear: "variant_unclear" }));
  it("a matched offer with an unclear value is built_in_unclear", () =>
    expect(pickOffer([offer("Reserved", { name: "Red" }), offer("InStock", { name: "Blue" })], { url: null, option: "Red" }, "in_stock")).toEqual({ unclear: "built_in_unclear" }));
  it("an offer address that cannot be read is skipped", () =>
    expect(pickOffer([offer("InStock", { url: "http://[bad" }), offer("OutOfStock", { url: "/products/w?variant=2" })], { url: "https://supplier.example/products/w?variant=2", option: null }, "in_stock")).toMatchObject({
      answer: "out_of_stock",
    }));
});

describe("pickOffer: offers of other products", () => {
  const link = { url: "https://supplier.example/products/w", option: null };
  it("ignores an offer whose address is another product", () => expect(pickOffer([offer("OutOfStock", { url: "https://supplier.example/products/other" })], link, "in_stock")).toBeNull());
  it("a listing whose products all agree does not answer for this link", () =>
    expect(pickOffer([offer("OutOfStock", { url: "/products/a" }), offer("OutOfStock", { url: "/products/b" })], link, "in_stock")).toBeNull());
  it("keeps this product's own offer beside related products", () =>
    expect(pickOffer([offer("InStock", { url: "/products/w" }), offer("OutOfStock", { url: "/products/other" })], link, "out_of_stock")).toMatchObject({ answer: "in_stock" }));
  it("a link through a collection path is the same product", () =>
    expect(pickOffer([offer("InStock", { url: "/products/w?variant=1" }), offer("OutOfStock", { url: "/products/w?variant=2" })], { url: "https://supplier.example/collections/tees/products/w?variant=2", option: null }, "in_stock")).toMatchObject({ answer: "out_of_stock" }));
  it("offers without an address still count", () => expect(pickOffer([offer("InStock")], link, "out_of_stock")).toMatchObject({ answer: "in_stock" }));
});
