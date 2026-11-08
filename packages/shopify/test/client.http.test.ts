// The GraphQL client and token provider together, against a real HTTP server.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createFakeShopify, type FakeShopify } from "./fake-shopify.js";
import { createShopifyClient } from "../src/client.js";
import { createTokenProvider } from "../src/token-provider.js";
import { isShopifyError } from "../src/errors.js";

let fake: FakeShopify;
beforeEach(async () => {
  fake = await createFakeShopify({ clientId: "the-id", clientSecret: "the-secret" });
});
afterEach(async () => {
  await fake.close();
});

const shopSchema = z.object({ shop: z.object({ name: z.string() }) });
const sleeps: number[] = [];

function client() {
  sleeps.length = 0;
  const tokens = createTokenProvider({
    shop: "my-store.myshopify.com",
    credentials: { type: "client_credentials", clientId: "the-id", clientSecret: "the-secret" },
    baseUrl: () => fake.url,
  });
  return createShopifyClient({
    shop: "my-store.myshopify.com",
    tokens,
    baseUrl: () => fake.url,
    sleep: async (ms) => void sleeps.push(ms),
  });
}

const failure = async (p: Promise<unknown>) => {
  try {
    await p;
    throw new Error("expected a rejection");
  } catch (e) {
    return isShopifyError(e) ? e.code : String(e);
  }
};

describe("client over real HTTP", () => {
  it("fetches a token, then sends the query to the pinned version with that token", async () => {
    const data = await client().query("{ shop { name } }", { schema: shopSchema });
    expect(data.shop.name).toBe("Fake Store");
    const [request] = fake.graphqlRequests();
    expect(request!.path).toBe("/admin/api/2026-10/graphql.json");
    expect(request!.headers["x-shopify-access-token"]).toBe("fake-access-token-1");
    expect(JSON.parse(request!.body)).toEqual({ query: "{ shop { name } }" });
  });

  it("recovers on its own when the token has been revoked", async () => {
    const c = client();
    await c.query("{ shop { name } }", { schema: shopSchema });
    fake.revokeIssuedTokens();
    const data = await c.query("{ shop { name } }", { schema: shopSchema });
    expect(data.shop.name).toBe("Fake Store");
    expect(fake.tokenRequests()).toHaveLength(2);
    expect(fake.graphqlRequests().at(-1)!.headers["x-shopify-access-token"]).toBe("fake-access-token-2");
  });

  it("backs off and succeeds when Shopify throttles twice", async () => {
    fake.setGraphQL((_req, count) =>
      count <= 2
        ? { body: { errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }] } }
        : { body: { data: { shop: { name: "Fake Store" } } } },
    );
    const data = await client().query("{ shop { name } }", { schema: shopSchema });
    expect(data.shop.name).toBe("Fake Store");
    expect(sleeps).toEqual([1000, 2000]);
    expect(fake.graphqlRequests()).toHaveLength(3);
  });

  it("reports a missing permission in plain terms", async () => {
    fake.setGraphQL(() => ({ body: { errors: [{ message: "Access denied", extensions: { code: "ACCESS_DENIED" } }] } }));
    expect(await failure(client().query("{ shop { name } }", { schema: shopSchema }))).toBe("no_access");
  });

  it("does not follow a redirect from the GraphQL endpoint, so the token never reaches another host", async () => {
    const elsewhere = await createFakeShopify();
    try {
      fake.setGraphQL(() => ({ status: 307, headers: { location: `${elsewhere.url}/admin/api/2026-10/graphql.json` }, body: "" }));
      expect(await failure(client().query("{ shop { name } }", { schema: shopSchema }))).toBe("unreachable");
      expect(elsewhere.requests).toHaveLength(0);
    } finally {
      await elsewhere.close();
    }
  });
});
