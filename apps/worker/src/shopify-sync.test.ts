import { describe, expect, it } from "vitest";
import { webhookUrlFor } from "./shopify-sync.js";

describe("webhookUrlFor", () => {
  it("is the app's own address plus the webhook path when the app is on https", () => {
    expect(webhookUrlFor("https://a.sslip.io")).toBe("https://a.sslip.io/api/shopify/webhooks");
  });

  it("is nothing on plain http or with no address, because Shopify only sends to https", () => {
    expect(webhookUrlFor("http://localhost:3000")).toBeUndefined();
    expect(webhookUrlFor(undefined)).toBeUndefined();
  });
});
