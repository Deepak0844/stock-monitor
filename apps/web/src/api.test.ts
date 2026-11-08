import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api.js";

const respond = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status });

afterEach(() => vi.unstubAllGlobals());

describe("api client", () => {
  it("returns null from getMe when the server says not signed in", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond(401, { error: { message: "x" } })));
    expect(await api.getMe()).toBeNull();
  });

  it("returns the owner from getMe when signed in", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond(200, { email: "o@example.com" })));
    expect(await api.getMe()).toEqual({ email: "o@example.com" });
  });

  it("passes the server's plain message through on a failed login", async () => {
    const body = { error: { code: "invalid_credentials", message: "Email or password is incorrect." } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond(401, body)));
    await expect(api.login("a@b.co", "pw")).rejects.toThrow("Email or password is incorrect.");
  });

  it("uses a friendly message when the server cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(api.login("a@b.co", "pw")).rejects.toThrow(/can't reach the server/i);
  });

  it("uses a generic message, never a raw error, when the reply is not JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>boom</html>", { status: 500 })));
    await expect(api.login("a@b.co", "pw")).rejects.toThrow("Something went wrong. Please try again.");
  });

  it("sends the credentials as JSON on login", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(200, { email: "a@b.co" }));
    vi.stubGlobal("fetch", fetchMock);
    await api.login("a@b.co", "pw");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/login");
    expect(init.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(init.body)).toEqual({ email: "a@b.co", password: "pw" });
  });

  it("sends logout with no JSON content type, because there is no body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await api.logout();
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.headers).toBeUndefined();
    expect(init.body).toBeUndefined();
  });

  it("gives errors the server's code and status, so a screen can put the message beside the right field", async () => {
    const body = { error: { code: "invalid_shop", message: "Enter your store address, like my-store.myshopify.com." } };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond(400, body)));
    await expect(api.shopify.connect({ shop: "x", clientId: "a", clientSecret: "b" })).rejects.toMatchObject({
      code: "invalid_shop",
      status: 400,
      message: "Enter your store address, like my-store.myshopify.com.",
    });
  });
});

describe("shopify calls", () => {
  const details = { shop: "my-store.myshopify.com", clientId: "id", clientSecret: "secret" };
  const record = { shop: "my-store.myshopify.com", status: "connected" };

  it("reads the connection, or null when there is none", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(respond(200, { connection: record })).mockResolvedValueOnce(respond(200, { connection: null }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await api.shopify.getConnection()).toEqual(record);
    expect(await api.shopify.getConnection()).toBeNull();
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/shopify/connection");
  });

  it("tests typed-in details by sending them, and the saved connection by sending nothing", async () => {
    const check = { shopName: "Acme", scopes: [], writeScopes: [], missingScopes: [], warnings: [] };
    const fetchMock = vi.fn().mockImplementation(async () => respond(200, check)); // a fresh response each call
    vi.stubGlobal("fetch", fetchMock);
    await api.shopify.test(details);
    await api.shopify.test();
    const [url1, init1] = fetchMock.mock.calls[0]!;
    expect(url1).toBe("/api/shopify/test");
    expect(JSON.parse(init1.body)).toEqual(details);
    const [, init2] = fetchMock.mock.calls[1]!;
    expect(init2.body).toBeUndefined();
    expect(init2.headers).toBeUndefined();
  });

  it("connects with the details and returns the connection and the check", async () => {
    const reply = { connection: record, shopName: "Acme", scopes: [], writeScopes: [], missingScopes: [], warnings: [] };
    const fetchMock = vi.fn().mockImplementation(async () => respond(200, reply));
    vi.stubGlobal("fetch", fetchMock);
    expect(await api.shopify.connect(details)).toEqual(reply);
    expect(fetchMock.mock.calls[0]![1].method).toBe("POST");
  });

  it("disconnects with a DELETE and no body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respond(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await api.shopify.disconnect();
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/shopify/connection");
    expect(fetchMock.mock.calls[0]![1].method).toBe("DELETE");
    expect(fetchMock.mock.calls[0]![1].body).toBeUndefined();
  });

  it("lists locations and chooses one", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respond(200, { locations: [{ id: "gid://shopify/Location/1", name: "Shop floor" }] }))
      .mockResolvedValueOnce(respond(200, { location: { id: "gid://shopify/Location/1", name: "Shop floor" } }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await api.shopify.locations()).toEqual([{ id: "gid://shopify/Location/1", name: "Shop floor" }]);
    expect(await api.shopify.chooseLocation("gid://shopify/Location/1")).toEqual({ id: "gid://shopify/Location/1", name: "Shop floor" });
    expect(fetchMock.mock.calls[1]![1].method).toBe("PUT");
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({ id: "gid://shopify/Location/1" });
  });

  it("starts a sync and reads the last run", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(respond(202, { queued: true })).mockResolvedValueOnce(respond(200, { lastRun: { id: 3, status: "running" } }));
    vi.stubGlobal("fetch", fetchMock);
    await api.shopify.startSync();
    expect((await api.shopify.getSync())?.id).toBe(3);
    expect(fetchMock.mock.calls[0]![1].method).toBe("POST");
  });

  it("passes the server's plain message through when Shopify is not connected", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respond(409, { error: { code: "not_connected", message: "Connect Shopify first." } })));
    await expect(api.shopify.startSync()).rejects.toMatchObject({ code: "not_connected", message: "Connect Shopify first." });
  });

  it("asks for a page of variants, leaving out a search and filter that are not set", async () => {
    const page = { items: [], total: 0, page: 1, pageSize: 25 };
    const fetchMock = vi.fn().mockImplementation(async () => respond(200, page));
    vi.stubGlobal("fetch", fetchMock);
    expect(await api.shopify.variants({ page: 1, pageSize: 25 })).toEqual(page);
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/shopify/variants?page=1&pageSize=25");
  });

  it("sends the search and the attention filter when they are set, safely encoded", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => respond(200, { items: [], total: 0, page: 2, pageSize: 25 }));
    vi.stubGlobal("fetch", fetchMock);
    await api.shopify.variants({ page: 2, pageSize: 25, search: "50% off & more", warningsOnly: true });
    const url = new URL(fetchMock.mock.calls[0]![0] as string, "http://x");
    expect(url.searchParams.get("search")).toBe("50% off & more");
    expect(url.searchParams.get("warningsOnly")).toBe("true");
    expect(url.searchParams.get("page")).toBe("2");
  });
});

describe("suppliers api", () => {
  const supplier = { id: "s1", name: "Acme" };
  const stub = (status: number, body?: unknown) => {
    const fetchMock = vi.fn().mockImplementation(async () => respond(status, body)); // a fresh Response each call
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  it("lists suppliers", async () => {
    const f = stub(200, { suppliers: [supplier] });
    expect(await api.suppliers.list()).toEqual([supplier]);
    expect(f.mock.calls[0]![0]).toBe("/api/suppliers");
  });

  it("gets one supplier by id", async () => {
    const f = stub(200, { supplier });
    expect(await api.suppliers.get("s1")).toEqual(supplier);
    expect(f.mock.calls[0]![0]).toBe("/api/suppliers/s1");
  });

  it("creates a supplier by posting JSON and returns it", async () => {
    const f = stub(201, { supplier });
    const input = { name: "Acme", websiteUrl: "https://acme.example/", loginUrl: null, checkIntervalMinutes: 60 };
    expect(await api.suppliers.create(input)).toEqual(supplier);
    const [url, init] = f.mock.calls[0]!;
    expect([url, init.method, JSON.parse(init.body)]).toEqual(["/api/suppliers", "POST", input]);
  });

  it("updates with PATCH and sends only what it is given", async () => {
    const f = stub(200, { supplier });
    await api.suppliers.update("s1", { name: "New" });
    const [url, init] = f.mock.calls[0]!;
    expect([url, init.method, JSON.parse(init.body)]).toEqual(["/api/suppliers/s1", "PATCH", { name: "New" }]);
  });

  it("deletes, pauses and resumes", async () => {
    const f = stub(200, { ok: true, supplier });
    await api.suppliers.remove("s1");
    await api.suppliers.pause("s1");
    await api.suppliers.resume("s1");
    expect(f.mock.calls.map(([url, init]) => `${init.method} ${url}`)).toEqual([
      "DELETE /api/suppliers/s1",
      "POST /api/suppliers/s1/pause",
      "POST /api/suppliers/s1/resume",
    ]);
  });

  it("keeps the server's message and error code, so a screen can show it beside the right field", async () => {
    stub(400, { error: { code: "invalid_website", message: "Enter the supplier's website address starting with https://" } });
    await expect(api.suppliers.create({ name: "A", websiteUrl: "x", loginUrl: null, checkIntervalMinutes: 60 })).rejects.toMatchObject({
      code: "invalid_website",
      status: 400,
      message: expect.stringMatching(/https/),
    });
  });
});
