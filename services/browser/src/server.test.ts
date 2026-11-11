import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { AbandonedError, QueueFullError } from "./job-queue.js";
import { createControlServer, type CaptureFn, type CheckPageFn, type SessionsApi, type VerifyFn } from "./server.js";

const TOKEN = "t".repeat(40);
const MARKER = "SESSION-COOKIE-MARKER-4c1e";
const state = { cookies: [{ name: "session", value: MARKER, domain: "shop.acme.example", path: "/" }], origins: [] };
const body = { url: "https://shop.acme.example/account", state };

let server: Server;
let base: string;
let verify: ReturnType<typeof vi.fn<VerifyFn>>;
let checkPage: ReturnType<typeof vi.fn<CheckPageFn>>;
let capture: ReturnType<typeof vi.fn<CaptureFn>>;
let sessions: { [K in keyof SessionsApi]: ReturnType<typeof vi.fn<SessionsApi[K]>> };
const ID = "11111111-1111-4111-8111-111111111111";
const logs: string[] = [];

beforeEach(async () => {
  logs.length = 0;
  verify = vi.fn<VerifyFn>().mockResolvedValue({ result: "ok", status: 200, blockedRequests: 0 });
  checkPage = vi.fn<CheckPageFn>().mockResolvedValue({ result: "ok", status: 200, blockedRequests: 0, finalUrl: "https://shop.acme.example/p", title: "P", heading: "P", softNotFound: false });
  capture = vi.fn<CaptureFn>().mockResolvedValue({ result: "ok", status: 200, blockedRequests: 0, finalUrl: "https://shop.acme.example/p", title: "P", heading: "P", softNotFound: false, description: { sections: [], buttons: [] }, picture: null });
  sessions = {
    open: vi.fn<SessionsApi["open"]>().mockResolvedValue({ ok: true, id: ID, expiresAt: "2026-11-08T12:00:00.000Z" }),
    finish: vi.fn<SessionsApi["finish"]>().mockResolvedValue(state),
    cancel: vi.fn<SessionsApi["cancel"]>().mockResolvedValue(true),
  };
  server = createControlServer({ token: TOKEN, verify, checkPage, capture, sessions, log: (line) => logs.push(line), maxBodyBytes: 100_000 });
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
    expect(verify).toHaveBeenCalledWith({ url: body.url, loginUrl: "https://shop.acme.example/login", state }, { signal: expect.any(AbortSignal) });
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

  it("includes the VNC password in the answer when the service has one, and leaves it out when it has none", async () => {
    const withPassword = createControlServer({ token: TOKEN, verify, sessions, vncPassword: "Ab3dE6gH" });
    await new Promise<void>((resolve) => withPassword.listen(0, "127.0.0.1", resolve));
    try {
      const url = `http://127.0.0.1:${(withPassword.address() as AddressInfo).port}/sessions`;
      const res = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ url: "https://a.example/" }) });
      expect(await res.json()).toEqual({ id: ID, expiresAt: "2026-11-08T12:00:00.000Z", vncPassword: "Ab3dE6gH" });
    } finally {
      withPassword.closeAllConnections();
      await new Promise((resolve) => withPassword.close(resolve));
    }
    const plain = await call("POST", "/sessions", TOKEN, { url: "https://a.example/" });
    expect(Object.keys(await plain.json())).toEqual(["id", "expiresAt"]);
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

describe("POST /check-page", () => {
  const call = (token: string | null = TOKEN, payload: unknown = body) =>
    fetch(`${base}/check-page`, { method: "POST", headers: { "content-type": "application/json", ...(token === null ? {} : { authorization: `Bearer ${token}` }) }, body: JSON.stringify(payload) });

  it("needs the control token and does nothing without it", async () => {
    expect((await call(null)).status).toBe(401);
    expect(checkPage).not.toHaveBeenCalled();
  });

  it("answers with what the page was", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ result: "ok", status: 200, finalUrl: "https://shop.acme.example/p", softNotFound: false });
    expect(checkPage).toHaveBeenCalledWith(expect.objectContaining({ url: body.url }), expect.anything());
  });

  it("refuses a request that is not an address and a session", async () => {
    expect((await call(TOKEN, { url: "ftp://x.test", state })).status).toBe(400);
    expect(checkPage).not.toHaveBeenCalled();
  });

  it("logs only the error name when the check fails, never the session", async () => {
    checkPage.mockRejectedValue(new Error(`boom ${MARKER}`));
    const res = await call();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "check_failed" });
    expect(logs.join("\n")).not.toContain(MARKER);
  });
});

describe("POST /capture", () => {
  const call = (token: string | null = TOKEN, payload: unknown = body, signal?: AbortSignal) =>
    fetch(`${base}/capture`, { method: "POST", headers: { "content-type": "application/json", ...(token === null ? {} : { authorization: `Bearer ${token}` }) }, body: JSON.stringify(payload), signal });

  it("needs the control token and does nothing without it", async () => {
    expect((await call(null)).status).toBe(401);
    expect(capture).not.toHaveBeenCalled();
  });

  it("passes on whether a picture was asked for", async () => {
    expect((await call(TOKEN, { ...body, picture: true })).status).toBe(200);
    expect(capture).toHaveBeenCalledWith(expect.objectContaining({ url: body.url, picture: true }), expect.anything());
  });

  it("passes on that a capture is a scheduled check, and refuses a value that is not yes or no", async () => {
    expect((await call(TOKEN, { ...body, scheduled: true })).status).toBe(200);
    expect(capture).toHaveBeenCalledWith(expect.objectContaining({ scheduled: true }), expect.anything());
    expect((await call(TOKEN, { ...body, scheduled: "yes" })).status).toBe(400);
  });

  it("refuses a picture setting that is not yes or no, and an address that is not a web address", async () => {
    expect((await call(TOKEN, { ...body, picture: "yes" })).status).toBe(400);
    expect((await call(TOKEN, { url: "ftp://x.test", state })).status).toBe(400);
    expect(capture).not.toHaveBeenCalled();
  });

  it("logs only the error name when the capture fails, never the session", async () => {
    capture.mockRejectedValue(new Error(`boom ${MARKER}`));
    const res = await call();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "capture_failed" });
    expect(logs.join("\n")).not.toContain(MARKER);
  });

  it("answers 503 busy when the job says the queue is full, without logging a failure", async () => {
    capture.mockRejectedValue(new QueueFullError());
    const res = await call();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "busy" });
    expect(logs.join("\n")).not.toContain("capture failed");
  });

  it("gives the job a signal that fires when the caller goes away", async () => {
    let seen: AbortSignal | undefined;
    capture.mockImplementation((_request, opts) => {
      seen = opts?.signal;
      return new Promise(() => {});
    });
    const gone = new AbortController();
    const pending = call(TOKEN, body, gone.signal).catch(() => {});
    await vi.waitFor(() => expect(seen).toBeDefined());
    expect(seen?.aborted).toBe(false);
    gone.abort();
    await pending;
    await vi.waitFor(() => expect(seen?.aborted).toBe(true));
  });

  it("does not abort the signal when the answer was sent normally", async () => {
    let seen: AbortSignal | undefined;
    capture.mockImplementation(async (_request, opts) => {
      seen = opts?.signal;
      return { result: "ok", status: 200, blockedRequests: 0, finalUrl: null, title: null, heading: null, softNotFound: false, description: { sections: [], buttons: [] }, picture: null };
    });
    await (await call()).text();
    await new Promise((r) => setTimeout(r, 20));
    expect(seen?.aborted).toBe(false);
  });

  it("says nothing and logs nothing when the caller left before the job's turn", async () => {
    capture.mockRejectedValue(new AbandonedError());
    const gone = new AbortController();
    const pending = call(TOKEN, body, gone.signal).catch(() => null);
    await new Promise((r) => setTimeout(r, 100));
    gone.abort();
    expect(await pending).toBeNull();
    expect(logs.join("\n")).not.toContain("capture failed");
  });
});
