import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createControlServer, type CaptureFn, type CheckPageFn, type InspectLoginFn, type LoginFn, type QuickReadFn, type SessionsApi, type VerifyFn } from "./server.js";

const TOKEN = "t".repeat(40);
const MARKER = "SESSION-COOKIE-MARKER-4c1e";
const state = { cookies: [{ name: "session", value: MARKER, domain: "shop.acme.example", path: "/" }], origins: [] };
const body = { url: "https://shop.acme.example/account", state };

let server: Server;
let base: string;
let verify: ReturnType<typeof vi.fn<VerifyFn>>;
let checkPage: ReturnType<typeof vi.fn<CheckPageFn>>;
let capture: ReturnType<typeof vi.fn<CaptureFn>>;
let quickRead: ReturnType<typeof vi.fn<QuickReadFn>>;
let sessions: { [K in keyof SessionsApi]: ReturnType<typeof vi.fn<SessionsApi[K]>> };
const ID = "11111111-1111-4111-8111-111111111111";
const logs: string[] = [];

beforeEach(async () => {
  logs.length = 0;
  verify = vi.fn<VerifyFn>().mockResolvedValue({ result: "ok", status: 200, blockedRequests: 0 });
  checkPage = vi.fn<CheckPageFn>().mockResolvedValue({ result: "ok", status: 200, blockedRequests: 0, finalUrl: "https://shop.acme.example/p", title: "P", heading: "P", softNotFound: false });
  capture = vi.fn<CaptureFn>().mockResolvedValue({ result: "ok", status: 200, blockedRequests: 0, finalUrl: "https://shop.acme.example/p", title: "P", heading: "P", softNotFound: false, description: { sections: [], buttons: [], offers: [] }, picture: null });
  sessions = {
    open: vi.fn<SessionsApi["open"]>().mockResolvedValue({ ok: true, id: ID, expiresAt: "2026-11-08T12:00:00.000Z" }),
    finish: vi.fn<SessionsApi["finish"]>().mockResolvedValue(state),
    cancel: vi.fn<SessionsApi["cancel"]>().mockResolvedValue(true),
  };
  quickRead = vi.fn<QuickReadFn>().mockResolvedValue({ result: "ok", status: 200, finalUrl: "https://shop.acme.example/p", softNotFound: false, offers: [{ availability: "InStock", url: null, sku: null, name: null }], signal: "looks_real", blocked: false });
  server = createControlServer({ token: TOKEN, verify, checkPage, capture, quickRead, sessions, log: (line) => logs.push(line), maxBodyBytes: 100_000 });
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
    ["an empty logged-in marker", { ...body, loggedInMarker: "" }, undefined],
    ["a 201-character logged-in marker", { ...body, loggedInMarker: "m".repeat(201) }, undefined],
    ["a logged-in marker that is not text", { ...body, loggedInMarker: 7 }, undefined],
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

  it("passes a refreshed session back to the worker, and keeps it out of the log", async () => {
    verify.mockResolvedValue({ result: "ok", status: 200, blockedRequests: 0, signal: "title", state } as Awaited<ReturnType<VerifyFn>>);
    expect(((await (await post(body)).json()) as { state: unknown }).state).toEqual(state);
    expect(logs.join("\n")).toContain("verify: ok");
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
    expect(sessions.open).toHaveBeenCalledWith("https://shop.acme.example/login", { stealth: false });
  });

  it("asks for a stealth window when the body says so", async () => {
    const res = await call("POST", "/sessions", TOKEN, { url: "https://a.example/", stealth: true });
    expect(res.status).toBe(201);
    expect(sessions.open).toHaveBeenCalledWith("https://a.example/", { stealth: true });
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

  it.each([["no address", {}], ["an ftp address", { url: "ftp://a.example/" }], ["a number", { url: 5 }], ["an extra field", { url: "https://a.example/", state: {} }], ["a stealth that is not true or false", { url: "https://a.example/", stealth: "yes" }], ["a null body", null], ["a list", []]])(
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
    expect(checkPage).toHaveBeenCalledWith(expect.objectContaining({ url: body.url }));
  });

  it("passes on the logged-in marker", async () => {
    expect((await call(TOKEN, { ...body, loggedInMarker: "Log out" })).status).toBe(200);
    expect(checkPage).toHaveBeenCalledWith(expect.objectContaining({ url: body.url, loggedInMarker: "Log out" }));
  });

  it("refuses a request that is not an address and a session", async () => {
    expect((await call(TOKEN, { url: "ftp://x.test", state })).status).toBe(400);
    expect(checkPage).not.toHaveBeenCalled();
  });

  it("passes on stealth when it is a yes or no, and refuses anything else", async () => {
    expect((await call(TOKEN, { ...body, stealth: true })).status).toBe(200);
    expect(checkPage).toHaveBeenCalledWith(expect.objectContaining({ url: body.url, stealth: true }));
    expect((await call(TOKEN, { ...body, stealth: "yes" })).status).toBe(400);
  });

  it("passes on a fresh profile when it is a yes or no, and refuses anything else", async () => {
    expect((await call(TOKEN, { ...body, freshProfile: true })).status).toBe(200);
    expect(checkPage).toHaveBeenCalledWith(expect.objectContaining({ url: body.url, freshProfile: true }));
    expect((await call(TOKEN, { ...body, freshProfile: "yes" })).status).toBe(400);
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
  const call = (token: string | null = TOKEN, payload: unknown = body) =>
    fetch(`${base}/capture`, { method: "POST", headers: { "content-type": "application/json", ...(token === null ? {} : { authorization: `Bearer ${token}` }) }, body: JSON.stringify(payload) });

  it("needs the control token and does nothing without it", async () => {
    expect((await call(null)).status).toBe(401);
    expect(capture).not.toHaveBeenCalled();
  });

  it("passes on whether a picture was asked for", async () => {
    expect((await call(TOKEN, { ...body, picture: true })).status).toBe(200);
    expect(capture).toHaveBeenCalledWith(expect.objectContaining({ url: body.url, picture: true }));
  });

  it("passes on the logged-in marker", async () => {
    expect((await call(TOKEN, { ...body, loggedInMarker: "Log out" })).status).toBe(200);
    expect(capture).toHaveBeenCalledWith(expect.objectContaining({ url: body.url, loggedInMarker: "Log out" }));
  });

  it("passes on that the page is public, and refuses a setting that is not yes or no", async () => {
    expect((await call(TOKEN, { ...body, publicPage: true })).status).toBe(200);
    expect(capture).toHaveBeenCalledWith(expect.objectContaining({ url: body.url, publicPage: true }));
    expect((await call(TOKEN, { ...body, publicPage: "yes" })).status).toBe(400);
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
});

describe("POST /login", () => {
  const PASSWORD = "s3cret-test";
  const good = { loginUrl: "https://shop.acme.example/login", checkUrl: "https://shop.acme.example/account", username: "buyer", password: PASSWORD, stealth: false };
  let login: ReturnType<typeof vi.fn<LoginFn>>;
  let lserver: Server;
  let lbase: string;
  beforeEach(async () => {
    login = vi.fn<LoginFn>().mockResolvedValue({ result: "ok", state });
    lserver = createControlServer({ token: TOKEN, verify, login, log: (line) => logs.push(line), maxBodyBytes: 100_000 });
    await new Promise<void>((resolve) => lserver.listen(0, "127.0.0.1", resolve));
    lbase = `http://127.0.0.1:${(lserver.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    lserver.closeAllConnections();
    await new Promise<void>((resolve) => lserver.close(() => resolve()));
  });
  const send = (payload: unknown, token: string | null = TOKEN) =>
    fetch(`${lbase}/login`, { method: "POST", headers: token === null ? {} : { authorization: `Bearer ${token}` }, body: JSON.stringify(payload) });

  it("refuses a call without the token", async () => {
    expect((await send(good, null)).status).toBe(401);
    expect(login).not.toHaveBeenCalled();
  });

  it.each([
    ["an empty password", { ...good, password: "" }],
    ["a 201-character username", { ...good, username: "u".repeat(201) }],
    ["an extra key", { ...good, extra: 1 }],
    ["an ftp address", { ...good, loginUrl: "ftp://shop.acme.example/login" }],
    ["a non-boolean stealth", { ...good, stealth: "yes" }],
    ["bad selectors", { ...good, selectors: { nope: "a" } }],
    ["an empty logged-in marker", { ...good, loggedInMarker: "" }],
    ["a 201-character logged-in marker", { ...good, loggedInMarker: "m".repeat(201) }],
  ])("answers 400 for %s", async (_n, payload) => {
    expect((await send(payload)).status).toBe(400);
    expect(login).not.toHaveBeenCalled();
  });

  it("passes the parsed request to login and returns the outcome", async () => {
    const full = { ...good, account: "A1", selectors: { submit: "#go" }, stealth: true, loggedInMarker: "Log out" };
    const res = await send(full);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: "ok", state });
    expect(login).toHaveBeenCalledWith(full);
    expect(logs).toEqual(["login: ok"]);
    expect(logs.join("\n")).not.toContain(PASSWORD);
  });

  it("logs the fixed reason code when no login form was found, and nothing else about the page", async () => {
    login.mockResolvedValue({ result: "form_not_found", why: "no_submit_button" });
    const res = await send(good);
    expect(res.status).toBe(200);
    expect(logs).toEqual(["login: form_not_found (no_submit_button)"]);
    expect(logs.join("\n")).not.toContain(PASSWORD);
  });

  it("logs the reason code for an unknown result too", async () => {
    login.mockResolvedValue({ result: "unknown", why: "nothing_sent" });
    const res = await send(good);
    expect(res.status).toBe(200);
    expect(logs).toEqual(["login: unknown (nothing_sent)"]);
  });

  it("answers 500 and logs only the error name when login throws", async () => {
    login.mockRejectedValue(new TypeError(`bad ${PASSWORD}`));
    const res = await send(good);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "login_failed" });
    expect(logs).toEqual(["login failed: TypeError"]);
  });
});

describe("a login that waits for an emailed code", () => {
  const good = { loginUrl: "https://shop.acme.example/login", checkUrl: "https://shop.acme.example/account", username: "buyer", password: "pw-test", stealth: false };
  let login: ReturnType<typeof vi.fn<LoginFn>>;
  let asked: (string | null)[];
  let cserver: Server;
  let cbase: string;
  const start = async (holdMs?: number) => {
    cserver = createControlServer({ token: TOKEN, verify, login, log: (line) => logs.push(line), ...(holdMs ? { loginHoldMs: holdMs } : {}) });
    await new Promise<void>((resolve) => cserver.listen(0, "127.0.0.1", resolve));
    cbase = `http://127.0.0.1:${(cserver.address() as AddressInfo).port}`;
  };
  beforeEach(async () => {
    asked = [];
    login = vi.fn<LoginFn>(async (_r, o) => {
      const code = (await o?.awaitCode?.()) ?? null;
      asked.push(code);
      return code === "482913" ? { result: "ok", state } : { result: "code_required" };
    });
    await start();
  });
  afterEach(async () => {
    cserver.closeAllConnections();
    await new Promise<void>((resolve) => cserver.close(() => resolve()));
  });
  const post = (path: string, payload?: unknown) =>
    fetch(`${cbase}${path}`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}` }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });

  it("answers code_needed with a hold, then the code finishes the login and answers its outcome", async () => {
    const first = await post("/login", { ...good, codeWanted: true });
    const { result, holdId } = (await first.json()) as { result: string; holdId: string };
    expect(result).toBe("code_needed");
    expect(holdId).toMatch(/^[0-9a-f-]{36}$/);
    expect(login).toHaveBeenCalledWith(good, expect.objectContaining({ awaitCode: expect.any(Function) }));
    const done = await post(`/login/${holdId}/code`, { code: "482913" });
    expect(done.status).toBe(200);
    expect(await done.json()).toEqual({ result: "ok", state });
    expect(asked).toEqual(["482913"]);
    expect(logs.join("\n")).not.toContain("482913");
  });

  it("takes a code once: a second one is 404", async () => {
    const { holdId } = (await (await post("/login", { ...good, codeWanted: true })).json()) as { holdId: string };
    await post(`/login/${holdId}/code`, { code: "111111" });
    expect((await post(`/login/${holdId}/code`, { code: "482913" })).status).toBe(404);
    expect(asked).toEqual(["111111"]);
  });

  it("a login that never asks answers its outcome straight away", async () => {
    login.mockResolvedValue({ result: "ok", state });
    expect(await (await post("/login", { ...good, codeWanted: true })).json()).toEqual({ result: "ok", state });
  });

  it("cancel ends the wait with no code", async () => {
    const { holdId } = (await (await post("/login", { ...good, codeWanted: true })).json()) as { holdId: string };
    expect((await post(`/login/${holdId}/cancel`)).status).toBe(204);
    await vi.waitFor(() => expect(asked).toEqual([null]));
    expect((await post(`/login/${holdId}/cancel`)).status).toBe(404);
  });

  it("a hold nobody answers ends by itself", async () => {
    cserver.closeAllConnections();
    await new Promise<void>((resolve) => cserver.close(() => resolve()));
    await start(200);
    const { holdId } = (await (await post("/login", { ...good, codeWanted: true })).json()) as { holdId: string };
    await vi.waitFor(() => expect(asked).toEqual([null]), { timeout: 2000 });
    expect((await post(`/login/${holdId}/code`, { code: "482913" })).status).toBe(404);
  });

  it.each([[{ code: "12" }], [{ code: "12345678901" }], [{ code: "12 34" }], [{}]])("refuses a code body %j", async (payload) => {
    const { holdId } = (await (await post("/login", { ...good, codeWanted: true })).json()) as { holdId: string };
    expect((await post(`/login/${holdId}/code`, payload)).status).toBe(400);
    await post(`/login/${holdId}/cancel`);
  });

  it("is 404 for an unknown hold, and refuses codeWanted that is not true", async () => {
    expect((await post("/login/00000000-0000-4000-8000-000000000000/code", { code: "482913" })).status).toBe(404);
    expect((await post("/login", { ...good, codeWanted: false })).status).toBe(400);
  });
});

describe("POST /quick-read", () => {
  const call = (payload: unknown, token: string | null = TOKEN) =>
    fetch(`${base}/quick-read`, { method: "POST", headers: { "content-type": "application/json", ...(token === null ? {} : { authorization: `Bearer ${token}` }) }, body: JSON.stringify(payload) });

  it("needs the control token", async () => {
    expect((await call({ url: "https://shop.acme.example/p", publicPage: true }, null)).status).toBe(401);
    expect(quickRead).not.toHaveBeenCalled();
  });

  it("reads only a public page at a web address", async () => {
    expect((await call({ url: "https://shop.acme.example/p" })).status).toBe(400);
    expect((await call({ url: "https://shop.acme.example/p", publicPage: "yes" })).status).toBe(400);
    expect((await call({ url: "ftp://x.test", publicPage: true })).status).toBe(400);
    expect(quickRead).not.toHaveBeenCalled();
  });

  it("answers with what the page was and its offers, and logs the rule, never the address", async () => {
    const res = await call({ url: "https://shop.acme.example/p?secret=1", publicPage: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ result: "ok", offers: [{ availability: "InStock" }] });
    expect(quickRead).toHaveBeenCalledWith({ url: "https://shop.acme.example/p?secret=1" });
    expect(logs).toContain("quick-read: ok (looks_real) http=200");
    expect(logs.join("\n")).not.toMatch(/shop\.acme|secret/);
  });

  it("says it failed, by name only, when the read throws", async () => {
    quickRead.mockRejectedValueOnce(new TypeError("boom https://shop.acme.example/p"));
    expect((await call({ url: "https://shop.acme.example/p", publicPage: true })).status).toBe(500);
    expect(logs).toContain("quick-read failed: TypeError");
  });
});

describe("POST /login/inspect", () => {
  const good = { loginUrl: "https://shop.acme.example/login", checkUrl: "https://shop.acme.example/", stealth: false };
  const inspection = {
    state: "form" as const, opened: false,
    found: { open: null, account: null, username: { label: "Email", selector: "#UserName" }, password: { label: "Password", selector: "#Password" }, submit: null },
    fields: [], buttons: [],
  };
  let inspectLogin: ReturnType<typeof vi.fn<InspectLoginFn>>;
  let iserver: Server;
  let ibase: string;
  beforeEach(async () => {
    inspectLogin = vi.fn<InspectLoginFn>().mockResolvedValue(inspection);
    iserver = createControlServer({ token: TOKEN, verify, inspectLogin, log: (line) => logs.push(line), maxBodyBytes: 100_000 });
    await new Promise<void>((resolve) => iserver.listen(0, "127.0.0.1", resolve));
    ibase = `http://127.0.0.1:${(iserver.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    iserver.closeAllConnections();
    await new Promise<void>((resolve) => iserver.close(() => resolve()));
  });
  const send = (payload: unknown, token: string | null = TOKEN) =>
    fetch(`${ibase}/login/inspect`, { method: "POST", headers: token === null ? {} : { authorization: `Bearer ${token}` }, body: JSON.stringify(payload) });

  it("refuses a call without the token", async () => {
    expect((await send(good, null)).status).toBe(401);
    expect(inspectLogin).not.toHaveBeenCalled();
  });
  it.each([
    ["no login address", { checkUrl: good.checkUrl, stealth: false }],
    ["no check address", { loginUrl: good.loginUrl, stealth: false }],
    ["a stealth flag that is not true or false", { ...good, stealth: "yes" }],
    ["an ftp address", { ...good, loginUrl: "ftp://shop.acme.example/login" }],
    ["selectors that are not selectors", { ...good, selectors: { username: "" } }],
    ["a key it does not know", { ...good, username: "buyer" }],
  ])("refuses %s", async (_name, payload) => {
    expect((await send(payload)).status).toBe(400);
    expect(inspectLogin).not.toHaveBeenCalled();
  });
  it("passes the request on and returns the inspection, logging only the state", async () => {
    const res = await send({ ...good, selectors: { submit: "#go" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(inspection);
    expect(inspectLogin).toHaveBeenCalledWith({ ...good, selectors: { submit: "#go" } });
    expect(logs).toEqual(["login inspect: form"]);
  });
  it("answers 500 inspect_failed and logs only the error name when it throws", async () => {
    inspectLogin.mockRejectedValue(new TypeError("bad https://shop.acme.example/login"));
    const res = await send(good);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "inspect_failed" });
    expect(logs).toEqual(["login inspect failed: TypeError"]);
  });
  it("has no route when the service cannot inspect", async () => {
    const res = await fetch(`${base}/login/inspect`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(good) });
    expect(res.status).toBe(404);
  });
});
