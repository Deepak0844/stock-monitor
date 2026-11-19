import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { verifyShopifyHmac } from "./webhook-hmac.js";

const SECRET = "the-secret";
const body = Buffer.from(JSON.stringify({ id: 1 }));
const sign = (b: Buffer) => createHmac("sha256", SECRET).update(b).digest("base64");

describe("verifyShopifyHmac", () => {
  it("accepts the right signature", () => {
    expect(verifyShopifyHmac(body, sign(body), SECRET)).toBe(true);
  });

  it("refuses when one byte of the body changed", () => {
    const changed = Buffer.from(body);
    changed[0] = changed[0]! ^ 1;
    expect(verifyShopifyHmac(changed, sign(body), SECRET)).toBe(false);
  });

  it("refuses a signature made with another secret", () => {
    expect(verifyShopifyHmac(body, createHmac("sha256", "other").update(body).digest("base64"), SECRET)).toBe(false);
  });

  it.each([undefined, "", "abc"])("refuses %j without throwing", (header) => {
    expect(verifyShopifyHmac(body, header, SECRET)).toBe(false);
  });
});
