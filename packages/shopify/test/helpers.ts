import { createFakeShopify, type FakeShopify } from "./fake-shopify.js";
import { createFakeCatalog, type FakeLocation, type FakeVariant } from "./fake-catalog.js";
import { createShopifyClient } from "../src/client.js";
import { createTokenProvider } from "../src/token-provider.js";

export async function startFakeStore(init: { locations: FakeLocation[]; variants: FakeVariant[] }) {
  const fake: FakeShopify = await createFakeShopify({ clientId: "the-id", clientSecret: "the-secret" });
  const catalog = createFakeCatalog(init);
  fake.setGraphQL(catalog.handler);
  const tokens = createTokenProvider({
    shop: "my-store.myshopify.com",
    credentials: { type: "client_credentials", clientId: "the-id", clientSecret: "the-secret" },
    baseUrl: () => fake.url,
  });
  const client = createShopifyClient({
    shop: "my-store.myshopify.com",
    tokens,
    baseUrl: () => fake.url,
    sleep: async () => {}, // never really wait in tests
  });
  return { fake, catalog, client, stop: () => fake.close() };
}
