// The token provider against a real HTTP server, so what goes over the wire is what Shopify would see.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakeShopify, type FakeShopify } from "./fake-shopify.js";
import { createTokenProvider } from "../src/token-provider.js";
import { isShopifyError } from "../src/errors.js";

let fake: FakeShopify;
beforeEach(async () => {
  fake = await createFakeShopify({ clientId: "the-id", clientSecret: "the-secret" });
});
afterEach(async () => {
  await fake.close();
});

const provider = (clientSecret = "the-secret") =>
  createTokenProvider({
    shop: "my-store.myshopify.com",
    credentials: { type: "client_credentials", clientId: "the-id", clientSecret },
    baseUrl: () => fake.url,
  });

const failure = async (p: Promise<unknown>) => {
  try {
    await p;
    throw new Error("expected a rejection");
  } catch (e) {
    return isShopifyError(e) ? e.code : String(e);
  }
};

describe("token provider over real HTTP", () => {
  it("gets a token with the right credentials", async () => {
    expect(await provider().getToken()).toBe("fake-access-token-1");
    const [request] = fake.tokenRequests();
    expect(request!.method).toBe("POST");
    expect(request!.headers["content-type"]).toMatch(/^application\/x-www-form-urlencoded/);
    expect(Object.fromEntries(new URLSearchParams(request!.body))).toEqual({
      grant_type: "client_credentials",
      client_id: "the-id",
      client_secret: "the-secret",
    });
  });

  it("is told the credentials are wrong when the secret does not match", async () => {
    expect(await failure(provider("wrong-secret").getToken())).toBe("rejected_credentials");
  });

  it("is told about a different organization", async () => {
    fake.setMode("wrong_organization");
    expect(await failure(provider().getToken())).toBe("wrong_organization");
  });

  it("treats a Shopify server error as unreachable and a busy reply as throttled", async () => {
    fake.setMode("server_error");
    expect(await failure(provider().getToken())).toBe("unreachable");
    fake.setMode("throttled");
    expect(await failure(provider().getToken())).toBe("throttled");
  });

  it("treats a reply that is not JSON as unexpected", async () => {
    fake.setMode("not_json");
    expect(await failure(provider().getToken())).toBe("unexpected_reply");
  });

  it("makes one request for ten simultaneous callers", async () => {
    const p = provider();
    await Promise.all(Array.from({ length: 10 }, () => p.getToken()));
    expect(fake.tokenRequests()).toHaveLength(1);
  });

  it("does not follow a redirect, so the credentials never reach the other host", async () => {
    const elsewhere = await createFakeShopify();
    try {
      fake.setMode("redirect", `${elsewhere.url}/admin/oauth/access_token`);
      expect(await failure(provider().getToken())).toBe("unreachable");
      expect(elsewhere.requests).toHaveLength(0);
    } finally {
      await elsewhere.close();
    }
  });
});
