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
});
