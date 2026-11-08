import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createShopifyClient } from "./client.js";
import { SHOPIFY_API_VERSION } from "./version.js";
import { isShopifyError, type ShopifyErrorCode } from "./errors.js";

const SHOP = "my-store.myshopify.com";
const shopSchema = z.object({ shop: z.object({ name: z.string() }) });
const QUERY = "{ shop { name } }";

const cost = (requested: number, available: number, rate = 50, max = 1000) => ({
  cost: {
    requestedQueryCost: requested,
    actualQueryCost: requested,
    throttleStatus: { maximumAvailable: max, currentlyAvailable: available, restoreRate: rate },
  },
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const okShop = (extensions: unknown = cost(2, 998)) => json({ data: { shop: { name: "Acme" } }, extensions });
const errorsBody = (code: string, message = "message from shopify") =>
  json({ errors: [{ message, extensions: { code } }] });

function setup(options: { maxAttempts?: number } = {}) {
  let now = 1_000_000;
  const sleeps: number[] = [];
  const tokens = {
    getToken: vi.fn<() => Promise<string>>(async () => "token-1"),
    invalidate: vi.fn<() => void>(),
  };
  const fetchMock = vi.fn<typeof fetch>(async () => okShop());
  const client = createShopifyClient({
    shop: SHOP,
    tokens,
    fetch: fetchMock,
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
    ...options,
  });
  return { client, tokens, fetchMock, sleeps, advance: (ms: number) => (now += ms) };
}

const run = (client: ReturnType<typeof setup>["client"], extra: { estimatedCost?: number } = {}) =>
  client.query(QUERY, { schema: shopSchema, ...extra });

const codeOf = async (promise: Promise<unknown>): Promise<ShopifyErrorCode | "not-a-shopify-error"> => {
  try {
    await promise;
    throw new Error("expected a rejection");
  } catch (e) {
    return isShopifyError(e) ? e.code : "not-a-shopify-error";
  }
};

describe("the request", () => {
  it("posts JSON to the pinned API version with the access token", async () => {
    const { client, fetchMock } = setup();
    await run(client);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(SHOPIFY_API_VERSION).toBe("2026-10");
    expect(url).toBe(`https://${SHOP}/admin/api/2026-10/graphql.json`);
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers["x-shopify-access-token"]).toBe("token-1");
    expect(headers["content-type"]).toBe("application/json");
    expect(JSON.parse(init?.body as string)).toEqual({ query: QUERY });
  });

  it("sends variables only when there are some", async () => {
    const { client, fetchMock } = setup();
    await client.query(QUERY, { schema: shopSchema, variables: { first: 5 } });
    expect(JSON.parse(fetchMock.mock.calls[0]![1]?.body as string)).toEqual({ query: QUERY, variables: { first: 5 } });
  });

  it("never follows a redirect, so the token cannot be forwarded to another host", async () => {
    const { client, fetchMock } = setup();
    await run(client);
    expect(fetchMock.mock.calls[0]![1]?.redirect).toBe("error");
  });

  it("returns the data, checked against the caller's schema", async () => {
    const { client } = setup();
    expect(await run(client)).toEqual({ shop: { name: "Acme" } });
  });

  it("never returns partial or misshapen data", async () => {
    const { client, fetchMock } = setup();
    fetchMock.mockResolvedValueOnce(json({ data: { shop: { name: 5 } } }));
    expect(await codeOf(run(client))).toBe("unexpected_reply");
    fetchMock.mockResolvedValueOnce(json({ data: null }));
    expect(await codeOf(run(client))).toBe("unexpected_reply");
    fetchMock.mockResolvedValueOnce(json({}));
    expect(await codeOf(run(client))).toBe("unexpected_reply");
  });

  it("treats a reply that is not JSON, or not an object, as unexpected", async () => {
    const { client, fetchMock } = setup();
    fetchMock.mockResolvedValueOnce(new Response("<html>hi</html>", { status: 200 }));
    expect(await codeOf(run(client))).toBe("unexpected_reply");
    fetchMock.mockResolvedValueOnce(json([]));
    expect(await codeOf(run(client))).toBe("unexpected_reply");
  });

  it("rejects an invalid store address before anything is sent", () => {
    const fetchMock = vi.fn();
    expect(() =>
      createShopifyClient({
        shop: "evil.com",
        tokens: { getToken: async () => "t", invalidate() {} },
        fetch: fetchMock as unknown as typeof fetch,
      }),
    ).toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("answers about access", () => {
  it("renews the token once and tries again when Shopify says the token is not valid", async () => {
    const { client, tokens, fetchMock } = setup();
    tokens.getToken.mockResolvedValueOnce("old-token").mockResolvedValueOnce("new-token");
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 401 }));
    expect(await run(client)).toEqual({ shop: { name: "Acme" } });
    expect(tokens.invalidate).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[1]![1]?.headers as Record<string, string>)["x-shopify-access-token"]).toBe("new-token");
  });

  it("gives up with 'rejected credentials' if the renewed token is refused too", async () => {
    const { client, fetchMock } = setup();
    fetchMock.mockResolvedValue(new Response("{}", { status: 401 }));
    expect(await codeOf(run(client))).toBe("rejected_credentials");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("maps a missing permission to 'no access'", async () => {
    const { client, fetchMock } = setup();
    fetchMock.mockResolvedValueOnce(errorsBody("ACCESS_DENIED"));
    expect(await codeOf(run(client))).toBe("no_access");
  });

  it.each([
    ["an inactive shop", () => errorsBody("SHOP_INACTIVE")],
    ["HTTP 402, a frozen shop", () => new Response("{}", { status: 402 })],
    ["HTTP 403, a flagged shop", () => new Response("{}", { status: 403 })],
    ["HTTP 423, a locked shop", () => new Response("{}", { status: 423 })],
  ])("maps %s to 'store unavailable', without retrying", async (_label, reply) => {
    const { client, fetchMock } = setup();
    fetchMock.mockResolvedValueOnce(reply());
    expect(await codeOf(run(client))).toBe("store_unavailable");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry a query that is too expensive", async () => {
    const { client, fetchMock } = setup();
    fetchMock.mockResolvedValueOnce(errorsBody("MAX_COST_EXCEEDED"));
    expect(await codeOf(run(client))).toBe("unexpected_reply");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry an unknown error, even when data came back too", async () => {
    const { client, fetchMock } = setup();
    fetchMock.mockResolvedValueOnce(
      json({ data: { shop: { name: "Acme" } }, errors: [{ message: "x", extensions: { code: "SOMETHING_NEW" } }] }),
    );
    expect(await codeOf(run(client))).toBe("unexpected_reply");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry a missing page", async () => {
    const { client, fetchMock } = setup();
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 404 }));
    expect(await codeOf(run(client))).toBe("unexpected_reply");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("rate limits and temporary trouble", () => {
  it("waits one second and tries again when Shopify says it is throttled", async () => {
    const { client, fetchMock, sleeps } = setup();
    fetchMock.mockResolvedValueOnce(errorsBody("THROTTLED"));
    expect(await run(client)).toEqual({ shop: { name: "Acme" } });
    expect(sleeps).toEqual([1000]);
  });

  it("waits longer each time, then gives up with 'throttled'", async () => {
    const { client, fetchMock, sleeps } = setup({ maxAttempts: 4 });
    fetchMock.mockImplementation(async () => errorsBody("THROTTLED"));
    expect(await codeOf(run(client))).toBe("throttled");
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(sleeps).toEqual([1000, 2000, 4000]);
  });

  it("treats an HTTP 429 like a throttled reply", async () => {
    const { client, fetchMock, sleeps } = setup();
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 429 }));
    await run(client);
    expect(sleeps).toEqual([1000]);
  });

  it.each([
    ["an HTTP 500", () => new Response("oops", { status: 500 })],
    ["an HTTP 503", () => new Response("oops", { status: 503 })],
    ["an INTERNAL_SERVER_ERROR reply", () => errorsBody("INTERNAL_SERVER_ERROR")],
  ])("retries %s and then succeeds", async (_label, reply) => {
    const { client, fetchMock, sleeps } = setup();
    fetchMock.mockResolvedValueOnce(reply());
    expect(await run(client)).toEqual({ shop: { name: "Acme" } });
    expect(sleeps).toEqual([1000]);
  });

  it("gives up with 'unreachable' when Shopify keeps failing", async () => {
    const { client, fetchMock } = setup({ maxAttempts: 3 });
    fetchMock.mockImplementation(async () => new Response("oops", { status: 502 }));
    expect(await codeOf(run(client))).toBe("unreachable");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries a network failure and gives up with 'unreachable'", async () => {
    const { client, fetchMock } = setup({ maxAttempts: 3 });
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed")).mockRejectedValueOnce(new TypeError("fetch failed"));
    expect(await run(client)).toEqual({ shop: { name: "Acme" } });
    fetchMock.mockImplementation(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await codeOf(run(client))).toBe("unreachable");
  });

  it("stops waiting after a maximum of eight seconds between tries", async () => {
    const { client, fetchMock, sleeps } = setup({ maxAttempts: 6 });
    fetchMock.mockImplementation(async () => errorsBody("THROTTLED"));
    await codeOf(run(client));
    expect(sleeps).toEqual([1000, 2000, 4000, 8000, 8000]);
  });
});

describe("keeping within the cost bucket", () => {
  it("does not wait before it has seen a response", async () => {
    const { client, sleeps } = setup();
    await run(client);
    expect(sleeps).toEqual([]);
  });

  it("waits before sending when the last reply says the bucket is nearly empty", async () => {
    const { client, fetchMock, sleeps } = setup();
    fetchMock.mockResolvedValueOnce(okShop(cost(100, 50, 50))); // 50 points left, refills 50 a second
    await run(client);
    await run(client, { estimatedCost: 150 });
    expect(sleeps).toEqual([2000]);
  });

  it("does not wait if enough time has passed to refill the bucket", async () => {
    const { client, fetchMock, sleeps, advance } = setup();
    fetchMock.mockResolvedValueOnce(okShop(cost(100, 50, 50)));
    await run(client);
    advance(3000);
    await run(client, { estimatedCost: 150 });
    expect(sleeps).toEqual([]);
  });

  it("expects the next query to cost about what the last one did", async () => {
    const { client, fetchMock, sleeps } = setup();
    fetchMock.mockResolvedValueOnce(okShop(cost(500, 20, 100))); // last query cost 500, 20 points left
    await run(client);
    await run(client); // no estimate given, so it assumes 500
    expect(sleeps).toEqual([4800]); // (500 - 20) / 100 per second
  });

  it("learns from the cost information in an error reply too", async () => {
    const { client, fetchMock, sleeps } = setup({ maxAttempts: 2 });
    fetchMock.mockResolvedValueOnce(
      json({ errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }], extensions: cost(100, 0, 50) }),
    );
    await run(client, { estimatedCost: 100 });
    expect(sleeps).toEqual([2000]); // waits for the bucket, longer than the 1 second minimum
  });
});

describe("secrets and Shopify's wording stay out of errors", () => {
  it("never copies Shopify's message text or the token into an error", async () => {
    const { client, tokens, fetchMock } = setup({ maxAttempts: 1 });
    tokens.getToken.mockResolvedValue("TOKEN-MARKER");
    fetchMock.mockResolvedValueOnce(errorsBody("ACCESS_DENIED", "denied for TOKEN-MARKER and REPLY-MARKER"));
    try {
      await run(client);
      expect.unreachable();
    } catch (e) {
      const text = `${(e as Error).message} ${JSON.stringify(e)} ${String(e)} ${(e as Error).stack}`;
      expect(text).not.toContain("TOKEN-MARKER");
      expect(text).not.toContain("REPLY-MARKER");
    }
  });

  it("does not leak the token through a network error either", async () => {
    const { client, tokens, fetchMock } = setup({ maxAttempts: 1 });
    tokens.getToken.mockResolvedValue("TOKEN-MARKER");
    fetchMock.mockRejectedValueOnce(new TypeError("failed with TOKEN-MARKER"));
    try {
      await run(client);
      expect.unreachable();
    } catch (e) {
      expect(`${(e as Error).message} ${JSON.stringify(e)} ${(e as Error).stack}`).not.toContain("TOKEN-MARKER");
    }
  });
});
