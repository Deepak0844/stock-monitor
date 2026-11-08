import { describe, expect, it, vi } from "vitest";
import { createTokenProvider, type Credentials } from "./token-provider.js";
import { isShopifyError, type ShopifyErrorCode } from "./errors.js";

const SHOP = "my-store.myshopify.com";
const MIN = 60_000;
const SECRET = "CLIENT-SECRET-MARKER";
const TOKEN_MARKER = "ACCESS-TOKEN-MARKER";

const creds: Credentials = { type: "client_credentials", clientId: "client-id-1", clientSecret: SECRET };

const tokenReply = (n: number, expiresIn = 86399, status = 200) =>
  new Response(JSON.stringify({ access_token: `${TOKEN_MARKER}-${n}`, scope: "read_products", expires_in: expiresIn }), {
    status,
    headers: { "content-type": "application/json" },
  });

function setup(opts: { credentials?: Credentials; expiresIn?: number } = {}) {
  let now = 1_000_000;
  let n = 0;
  const fetchMock = vi.fn<typeof fetch>(async () => tokenReply(++n, opts.expiresIn));
  const provider = createTokenProvider({
    shop: SHOP,
    credentials: opts.credentials ?? creds,
    fetch: fetchMock as unknown as typeof fetch,
    now: () => now,
  });
  return { provider, fetchMock, advance: (ms: number) => (now += ms) };
}

const codeOf = async (promise: Promise<unknown>): Promise<ShopifyErrorCode | "not-a-shopify-error"> => {
  try {
    await promise;
    throw new Error("expected a rejection");
  } catch (e) {
    return isShopifyError(e) ? e.code : "not-a-shopify-error";
  }
};

describe("static token", () => {
  it("returns the saved token and never calls Shopify", async () => {
    const fetchMock = vi.fn();
    const provider = createTokenProvider({
      shop: SHOP,
      credentials: { type: "static_token", accessToken: "saved-token" },
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(await provider.getToken()).toBe("saved-token");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("credentials are checked when the provider is created", () => {
  it.each([
    ["an empty client id", { type: "client_credentials", clientId: "", clientSecret: "s" }],
    ["an empty client secret", { type: "client_credentials", clientId: "i", clientSecret: "" }],
    ["an empty static token", { type: "static_token", accessToken: "" }],
  ] as const)("%s", (_label, credentials) => {
    expect(() => createTokenProvider({ shop: SHOP, credentials })).toThrow();
  });

  it("rejects an invalid store address before doing anything", () => {
    const fetchMock = vi.fn();
    for (const shop of ["evil.com", "x.myshopify.com.evil.com", "https://x.myshopify.com"]) {
      try {
        createTokenProvider({ shop, credentials: creds, fetch: fetchMock as unknown as typeof fetch });
        expect.unreachable();
      } catch (e) {
        expect(isShopifyError(e) && e.code).toBe("invalid_shop");
      }
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("requesting a token", () => {
  it("sends a form-encoded POST to the store with the three documented fields and no scope", async () => {
    const { provider, fetchMock } = setup();
    await provider.getToken();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`https://${SHOP}/admin/oauth/access_token`);
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)["content-type"]).toBe("application/x-www-form-urlencoded");
    const form = new URLSearchParams(init?.body as string);
    expect(Object.fromEntries(form)).toEqual({
      grant_type: "client_credentials",
      client_id: "client-id-1",
      client_secret: SECRET,
    });
  });

  it("never follows a redirect, so credentials cannot be forwarded to another host", async () => {
    const { provider, fetchMock } = setup();
    await provider.getToken();
    expect(fetchMock.mock.calls[0]![1]?.redirect).toBe("error");
  });

  it("returns the token from the reply", async () => {
    const { provider } = setup();
    expect(await provider.getToken()).toBe(`${TOKEN_MARKER}-1`);
  });

  it("gives up on a request that takes too long", async () => {
    const hanging = vi.fn(
      (_u: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const provider = createTokenProvider({
      shop: SHOP,
      credentials: creds,
      fetch: hanging as unknown as typeof fetch,
      timeoutMs: 30,
    });
    expect(await codeOf(provider.getToken())).toBe("unreachable");
  });
});

describe("reusing and refreshing the token", () => {
  it("reuses a token that is not near expiry", async () => {
    const { provider, fetchMock, advance } = setup();
    await provider.getToken();
    advance(60 * MIN);
    expect(await provider.getToken()).toBe(`${TOKEN_MARKER}-1`);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refreshes about 10 minutes before the token expires", async () => {
    const { provider, fetchMock, advance } = setup(); // expires_in 86399 s, about 1440 minutes
    await provider.getToken();
    advance(1440 * MIN - 11 * MIN - 1000);
    expect(await provider.getToken()).toBe(`${TOKEN_MARKER}-1`);
    advance(2 * MIN);
    expect(await provider.getToken()).toBe(`${TOKEN_MARKER}-2`);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses the lifetime from Shopify's reply, not a fixed 24 hours", async () => {
    const { provider, fetchMock, advance } = setup({ expiresIn: 3600 });
    await provider.getToken();
    advance(40 * MIN);
    expect(await provider.getToken()).toBe(`${TOKEN_MARKER}-1`);
    advance(15 * MIN); // 55 minutes in, inside the last 10 minutes
    expect(await provider.getToken()).toBe(`${TOKEN_MARKER}-2`);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not ask for a new token on every call when the lifetime is very short", async () => {
    const { provider, fetchMock, advance } = setup({ expiresIn: 600 }); // 10 minutes
    await provider.getToken();
    advance(2 * MIN);
    await provider.getToken();
    await provider.getToken();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shares one request between many simultaneous callers", async () => {
    const { provider, fetchMock } = setup();
    const tokens = await Promise.all(Array.from({ length: 10 }, () => provider.getToken()));
    expect(new Set(tokens).size).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shares one refresh between simultaneous callers when the token is due", async () => {
    const { provider, fetchMock, advance } = setup();
    await provider.getToken();
    advance(1435 * MIN);
    const tokens = await Promise.all(Array.from({ length: 10 }, () => provider.getToken()));
    expect(new Set(tokens)).toEqual(new Set([`${TOKEN_MARKER}-2`]));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("asks for a new token after invalidate()", async () => {
    const { provider, fetchMock } = setup();
    await provider.getToken();
    provider.invalidate();
    expect(await provider.getToken()).toBe(`${TOKEN_MARKER}-2`);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps using the current token if a refresh fails while the token is still valid", async () => {
    const { provider, fetchMock, advance } = setup();
    await provider.getToken();
    advance(1435 * MIN); // due for refresh, but about 5 minutes of life left
    fetchMock.mockRejectedValueOnce(new TypeError("network down"));
    expect(await provider.getToken()).toBe(`${TOKEN_MARKER}-1`);
  });

  it("does not retry on every call while Shopify is down and the old token still works", async () => {
    const { provider, fetchMock, advance } = setup();
    await provider.getToken();
    advance(1435 * MIN);
    fetchMock.mockRejectedValueOnce(new TypeError("network down"));
    await provider.getToken(); // falls back to the old token
    await provider.getToken();
    await provider.getToken();
    expect(fetchMock).toHaveBeenCalledTimes(2); // the first request, and the one failed refresh
    advance(31_000);
    expect(await provider.getToken()).toBe(`${TOKEN_MARKER}-2`); // tries again after the wait
  });

  it("fails once the token has expired and cannot be refreshed", async () => {
    const { provider, fetchMock, advance } = setup();
    await provider.getToken();
    advance(1441 * MIN);
    fetchMock.mockRejectedValueOnce(new TypeError("network down"));
    expect(await codeOf(provider.getToken())).toBe("unreachable");
  });

  it("does not remember a failure, so the next call tries again", async () => {
    const { provider, fetchMock } = setup();
    fetchMock.mockRejectedValueOnce(new TypeError("network down"));
    expect(await codeOf(provider.getToken())).toBe("unreachable");
    expect(await provider.getToken()).toMatch(TOKEN_MARKER);
  });
});

describe("what Shopify's answers mean", () => {
  const replyWith = (status: number, body: string) => {
    const fetchMock = vi.fn(async () => new Response(body, { status }));
    return createTokenProvider({ shop: SHOP, credentials: creds, fetch: fetchMock as unknown as typeof fetch });
  };

  it.each([400, 401, 403])("%i means the credentials were rejected", async (status) => {
    expect(await codeOf(replyWith(status, '{"error":"invalid_client"}').getToken())).toBe("rejected_credentials");
  });

  it("429 means Shopify wants us to slow down", async () => {
    expect(await codeOf(replyWith(429, "{}").getToken())).toBe("throttled");
  });

  it.each([500, 502, 503])("%i means Shopify cannot be reached right now", async (status) => {
    expect(await codeOf(replyWith(status, "oops").getToken())).toBe("unreachable");
  });

  it("recognises the different-organization message", async () => {
    const body = "Oauth error shop_not_permitted: Client credentials cannot be performed on this shop.";
    expect(await codeOf(replyWith(400, body).getToken())).toBe("wrong_organization");
    expect(await codeOf(replyWith(403, body).getToken())).toBe("wrong_organization");
  });

  it.each([
    ["a reply that is not JSON", "<html>hi</html>"],
    ["a reply with no access_token", '{"scope":"read_products","expires_in":86399}'],
    ["an empty access_token", '{"access_token":"","scope":"x","expires_in":86399}'],
    ["a reply with no expires_in", '{"access_token":"t","scope":"x"}'],
    ["an expires_in of zero", '{"access_token":"t","scope":"x","expires_in":0}'],
    ["a negative expires_in", '{"access_token":"t","scope":"x","expires_in":-5}'],
    ["a text expires_in", '{"access_token":"t","scope":"x","expires_in":"soon"}'],
    ["a JSON array", "[]"],
  ])("%s is an unexpected reply", async (_label, body) => {
    expect(await codeOf(replyWith(200, body).getToken())).toBe("unexpected_reply");
  });

  it("an unexpected success status is an unexpected reply", async () => {
    expect(await codeOf(replyWith(302, "").getToken())).toBe("unexpected_reply");
  });

  it("treats a network failure as unreachable", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const provider = createTokenProvider({ shop: SHOP, credentials: creds, fetch: fetchMock as unknown as typeof fetch });
    expect(await codeOf(provider.getToken())).toBe("unreachable");
  });

  it("a rejected refresh clears the old token instead of reusing it", async () => {
    const { provider, fetchMock, advance } = setup();
    await provider.getToken();
    advance(1435 * MIN);
    fetchMock.mockResolvedValueOnce(new Response('{"error":"invalid_client"}', { status: 401 }));
    expect(await codeOf(provider.getToken())).toBe("rejected_credentials");
  });
});

describe("secrets stay out of errors", () => {
  it("never puts the client secret or a token in an error's message or serialised form", async () => {
    const fetchMock = vi.fn(async () => new Response(`echo ${SECRET} ${TOKEN_MARKER}`, { status: 401 }));
    const provider = createTokenProvider({ shop: SHOP, credentials: creds, fetch: fetchMock as unknown as typeof fetch });
    try {
      await provider.getToken();
      expect.unreachable();
    } catch (e) {
      const text = `${(e as Error).message} ${JSON.stringify(e)} ${String(e)} ${(e as Error).stack}`;
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain(TOKEN_MARKER);
    }
  });

  it("does not leak a secret that appears in a network error", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError(`connect failed for ${SECRET}`);
    });
    const provider = createTokenProvider({ shop: SHOP, credentials: creds, fetch: fetchMock as unknown as typeof fetch });
    try {
      await provider.getToken();
      expect.unreachable();
    } catch (e) {
      expect(`${(e as Error).message} ${JSON.stringify(e)} ${(e as Error).stack}`).not.toContain(SECRET);
    }
  });
});
