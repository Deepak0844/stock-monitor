import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createControlServer, type SessionsApi, type VerifyFn } from "./server.js";

const TOKEN = "t".repeat(40);
const MARKER = "SESSION-COOKIE-MARKER-4c1e";
const state = { cookies: [{ name: "session", value: MARKER, domain: "shop.acme.example", path: "/" }], origins: [] };
const body = { url: "https://shop.acme.example/account", state };

let server: Server;
let base: string;
let verify: ReturnType<typeof vi.fn<VerifyFn>>;
let sessions: { [K in keyof SessionsApi]: ReturnType<typeof vi.fn<SessionsApi[K]>> };
const ID = "11111111-1111-4111-8111-111111111111";
const logs: string[] = [];

beforeEach(async () => {
  logs.length = 0;
  verify = vi.fn<VerifyFn>().mockResolvedValue({ result: "ok", status: 200, blockedRequests: 0 });
  sessions = {
    open: vi.fn<SessionsApi["open"]>().mockResolvedValue({ ok: true, id: ID, expiresAt: "2026-11-08T12:00:00.000Z" }),
    finish: vi.fn<SessionsApi["finish"]>().mockResolvedValue(state),
    cancel: vi.fn<SessionsApi["cancel"]>().mockResolvedValue(true),
  };
  server = createControlServer({ token: TOKEN, verify, sessions, log: (line) => logs.push(line), maxBodyBytes: 100_000 });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const post = (payload: unknown, token: string | null = TOKEN, raw?: string) =>
  fetch(`${base}/verify`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token === null ? {} : { authorization: `Bearer ${token}` }) },
    body: raw ?? JSON.stringify(payload),
  });

describe("the control token", () => {
  it.each([["no header", null], ["the wrong token", "x".repeat(40)], ["a token of another length", "short"], ["an empty token", ""]])("refuses %s and does nothing", async (_n, token) => {
    const res = await post(body, token);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorised" });
    expect(verify).not.toHaveBeenCalled();
  });

  it("refuses a token that is not sent as a Bearer token", async () => {
    const res = await fetch(`${base}/verify`, { method: "POST", headers: { authorization: TOKEN }, body: JSON.stringify(body) });
    expect(res.status).toBe(401);
  });

  it("asks for the token before saying whether an address exists", async () => {
    expect((await fetch(`${base}/nothing`)).status).toBe(401);
    expect((await fetch(`${base}/nothing`, { headers: { authorization: `Bearer ${TOKEN}` } })).status).toBe(404);
  });

  it("answers the health check without a token and says nothing else", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});

describe("POST /verify", () => {
  it("passes the request to the verifier and returns its answer", async () => {
    const res = await post({ ...body, loginUrl: "https://shop.acme.example/login" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: "ok", status: 200, blockedRequests: 0 });
    expect(verify).toHaveBeenCalledWith({ url: body.url, loginUrl: "https://shop.acme.example/login", state });
  });

  it("never echoes the session state in the answer", async () => {
    expect(await (await post(body)).text()).not.toContain(MARKER);
  });

  it.each([
    ["not JSON", undefined, "{nope"],
    ["an array", [1], undefined],
    ["no address", { state }, undefined],
    ["a number as the address", { url: 5, state }, undefined],
    ["an ftp address", { url: "ftp://shop.acme.example/", state }, undefined],
    ["a file address", { url: "file:///etc/passwd", state }, undefined],
    ["an address that is not one", { url: "not a url", state }, undefined],
    ["no state", { url: body.url }, undefined],
    ["a state of the wrong shape", { url: body.url, state: { cookies: "x", origins: [] } }, undefined],
    ["a login address that is not text", { ...body, loginUrl: 7 }, undefined],
    ["an address over 2048 characters", { url: `https://shop.acme.example/${"a".repeat(2100)}`, state }, undefined],
  ])("refuses %s with a plain 400 and does nothing", async (_n, payload, raw) => {
    const res = await post(payload, TOKEN, raw);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_request" });
    expect(verify).not.toHaveBeenCalled();
  });

  it("refuses a body that is too large", async () => {
    const res = await post({ url: body.url, state: { cookies: [{ value: "x".repeat(200_000) }], origins: [] } });
    expect(res.status).toBe(413);
    expect(verify).not.toHaveBeenCalled();
  });

  it("answers 500 with no detail when the check itself breaks, and keeps the state out of the log", async () => {
    verify.mockRejectedValue(Object.assign(new Error(`page.goto: net::ERR failed for ${body.url}?token=${MARKER}`), { name: "TimeoutError" }));
    const res = await post(body);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "verify_failed" });
    expect(logs.join("\n")).toContain("TimeoutError");
    expect(logs.join("\n")).not.toContain(MARKER);
  });

  it("only accepts POST", async () => {
    expect((await fetch(`${base}/verify`, { headers: { authorization: `Bearer ${TOKEN}` } })).status).toBe(404);
  });
});

describe("the live window routes", () => {
  const call = (method: string, path: string, token: string | null = TOKEN, payload?: unknown) =>
    fetch(`${base}${path}`, {
      method,
      headers: { "content-type": "application/json", ...(token === null ? {} : { authorization: `Bearer ${token}` }) },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });

  it.each([
    ["POST", "/sessions"],
    ["POST", `/sessions/${ID}/finish`],
    ["DELETE", `/sessions/${ID}`],
  ])("%s %s needs the token and does nothing without it", async (method, path) => {
    expect((await call(method, path, null, { url: "https://a.example/" })).status).toBe(401);
    expect((await call(method, path, "x".repeat(40), { url: "https://a.example/" })).status).toBe(401);
    expect(sessions.open).not.toHaveBeenCalled();
    expect(sessions.finish).not.toHaveBeenCalled();
    expect(sessions.cancel).not.toHaveBeenCalled();
  });

  it("opens a window and returns its id and expiry", async () => {
    const res = await call("POST", "/sessions", TOKEN, { url: "https://shop.acme.example/login" });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: ID, expiresAt: "2026-11-08T12:00:00.000Z" });
    expect(sessions.open).toHaveBeenCalledWith("https://shop.acme.example/login");
  });

  it.each([["no address", {}], ["an ftp address", { url: "ftp://a.example/" }], ["a number", { url: 5 }], ["an extra field", { url: "https://a.example/", state: {} }]])(
    "refuses %s with a plain 400",
    async (_n, payload) => {
      const res = await call("POST", "/sessions", TOKEN, payload);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_request" });
      expect(sessions.open).not.toHaveBeenCalled();
    },
  );

  it("says plainly that a window is already open, with a 409", async () => {
    sessions.open.mockResolvedValue({ ok: false, reason: "busy" });
    const res = await call("POST", "/sessions", TOKEN, { url: "https://a.example/" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "session_open", message: "A login window is already open. Finish or cancel it first." });
  });

  it("says the window could not start, with a 502 and no detail", async () => {
    sessions.open.mockResolvedValue({ ok: false, reason: "failed" });
    const res = await call("POST", "/sessions", TOKEN, { url: "https://a.example/" });
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "window_failed" });
  });

  it("finishing returns the saved session", async () => {
    const res = await call("POST", `/sessions/${ID}/finish`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state });
    expect(sessions.finish).toHaveBeenCalledWith(ID);
  });

  it("answers 404 when there is no such window, for finish and cancel, and for an id that is not an id", async () => {
    sessions.finish.mockResolvedValue(null);
    sessions.cancel.mockResolvedValue(false);
    for (const [method, path] of [["POST", `/sessions/${ID}/finish`], ["DELETE", `/sessions/${ID}`], ["POST", "/sessions/not-an-id/finish"], ["DELETE", "/sessions/not-an-id"]]) {
      const res = await call(method as string, path as string);
      expect(res.status, `${method} ${path}`).toBe(404);
      expect(await res.json()).toEqual({ error: "session_not_found" });
    }
  });

  it("cancelling answers 204", async () => {
    expect((await call("DELETE", `/sessions/${ID}`)).status).toBe(204);
    expect(sessions.cancel).toHaveBeenCalledWith(ID);
  });

  it("answers 500 with no detail, and logs only the error name, when finishing breaks", async () => {
    sessions.finish.mockRejectedValue(Object.assign(new Error(`failed with ${MARKER}`), { name: "TargetClosedError" }));
    const res = await call("POST", `/sessions/${ID}/finish`);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "session_failed" });
    expect(logs.join("\n")).toContain("TargetClosedError");
    expect(logs.join("\n")).not.toContain(MARKER);
  });
});
