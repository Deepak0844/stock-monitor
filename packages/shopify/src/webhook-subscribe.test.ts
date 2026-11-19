import { afterEach, describe, expect, it } from "vitest";
import { ensureWebhookSubscriptions, WEBHOOK_TOPICS } from "./webhook-subscribe.js";
import { isShopifyError } from "./errors.js";
import { LOC_A } from "../test/fake-catalog.js";
import { startFakeStore } from "../test/helpers.js";

type Store = Awaited<ReturnType<typeof startFakeStore>>;
let store: Store | undefined;
afterEach(async () => {
  await store?.stop();
  store = undefined;
});

const URI = "https://shop-app.example/api/shopify/webhooks";
const start = async () => (store = await startFakeStore({ locations: [{ id: LOC_A, name: "Shop floor", isActive: true }], variants: [] }));

describe("ensureWebhookSubscriptions", () => {
  it("signs up for product changes and stock changes", () => {
    expect([...WEBHOOK_TOPICS]).toEqual(["PRODUCTS_CREATE", "PRODUCTS_UPDATE", "PRODUCTS_DELETE", "INVENTORY_LEVELS_UPDATE"]);
  });

  it("creates all four when none exist", async () => {
    const s = await start();
    expect((await ensureWebhookSubscriptions(s.client, URI)).created).toEqual([...WEBHOOK_TOPICS]);
    expect(s.catalog.subscriptions.map((x) => [x.topic, x.uri])).toEqual(WEBHOOK_TOPICS.map((t) => [t, URI]));
  });

  it("creates only the missing ones, so running it again adds nothing", async () => {
    const s = await start();
    s.catalog.subscriptions.push({ id: "gid://shopify/WebhookSubscription/99", topic: "PRODUCTS_UPDATE", uri: URI });
    expect((await ensureWebhookSubscriptions(s.client, URI)).created).toEqual(["PRODUCTS_CREATE", "PRODUCTS_DELETE", "INVENTORY_LEVELS_UPDATE"]);
    expect((await ensureWebhookSubscriptions(s.client, URI)).created).toEqual([]);
    expect(s.catalog.subscriptions).toHaveLength(4);
  });

  it("a sign-up pointing at another address does not count", async () => {
    const s = await start();
    s.catalog.subscriptions.push({ id: "gid://shopify/WebhookSubscription/99", topic: "PRODUCTS_UPDATE", uri: "https://old.example/hook" });
    expect((await ensureWebhookSubscriptions(s.client, URI)).created).toHaveLength(4);
  });

  it("a refused sign-up is an unexpected_reply ShopifyError", async () => {
    const s = await start();
    s.catalog.setSubscriptionsRefuse(true);
    const error = await ensureWebhookSubscriptions(s.client, URI).catch((e: unknown) => e);
    expect(isShopifyError(error) && error.code).toBe("unexpected_reply");
  });
});
