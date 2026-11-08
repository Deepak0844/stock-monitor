import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createBrowserClient } from "./browser-client.js";
import { createFakeBrowserService, FAKE_CONTROL_TOKEN, type FakeBrowserService } from "../test/fake-browser-service.js";

let fake: FakeBrowserService;
const client = (over: Partial<Parameters<typeof createBrowserClient>[0]> = {}) =>
  createBrowserClient({ baseUrl: fake.url, token: FAKE_CONTROL_TOKEN, ...over });
const ID = "00000000-0000-4000-8000-000000000001";
const COOKIE = "COOKIE-VALUE-MARKER-71aa";

beforeAll(async () => {
  fake = await createFakeBrowserService();
});
afterAll(async () => {
  await fake.close();
});
beforeEach(() => {
  fake.requests.length = 0;
  Object.assign(fake.behaviour, { open: "ok", finish: "ok", cancel: "ok", state: { cookies: [], origins: [] }, vncPassword: "Ab3dE6gH", delayMs: 0 });
});

describe("openSession", () => {
  it("opens a window, sending the address and the control token, and returns the id, expiry and VNC password", async () => {
    const r = await client().openSession("https://shop.acme.example/login");
    expect(r).toMatchObject({ ok: true, id: expect.stringMatching(/^[0-9a-f-]{36}$/), expiresAt: expect.any(String), vncPassword: "Ab3dE6gH" });
    expect(fake.requests[0]).toMatchObject({ method: "POST", path: "/sessions", auth: `Bearer ${FAKE_CONTROL_TOKEN}`, body: { url: "https://shop.acme.example/login" } });
  });
  it("works whether or not the base address ends with a slash, and leaves out a password that is not sent", async () => {
    fake.behaviour.vncPassword = undefined;
    const r = await client({ baseUrl: `${fake.url}/` }).openSession("https://a.example/");
    expect(r.ok && r.vncPassword).toBeUndefined();
    expect(r.ok).toBe(true);
  });
  it("says busy when a window is already open", async () => {
    fake.behaviour.open = "busy";
    expect(await client().openSession("https://a.example/")).toEqual({ ok: false, reason: "busy" });
  });
  it("says failed when the window could not start, or the answer makes no sense", async () => {
    fake.behaviour.open = "fail";
    expect(await client().openSession("https://a.example/")).toEqual({ ok: false, reason: "failed" });
    fake.behaviour.open = "garbage";
    expect(await client().openSession("https://a.example/")).toEqual({ ok: false, reason: "failed" });
  });
  it("says failed, not busy, when the token is wrong", async () => {
    expect(await client({ token: "w".repeat(40) }).openSession("https://a.example/")).toEqual({ ok: false, reason: "failed" });
  });
  it("says unavailable when nothing answers, without throwing", async () => {
    expect(await client({ baseUrl: "http://127.0.0.1:1" }).openSession("https://a.example/")).toEqual({ ok: false, reason: "unavailable" });
  });
  it("says unavailable when the service is too slow", async () => {
    fake.behaviour.delayMs = 400;
    expect(await client({ timeoutMs: 100 }).openSession("https://a.example/")).toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("finishSession", () => {
  it("returns the saved session", async () => {
    const state = { cookies: [{ name: "s", value: COOKIE }], origins: [] };
    fake.behaviour.state = state;
    expect(await client().finishSession(ID)).toEqual({ ok: true, state });
    expect(fake.requests[0]).toMatchObject({ method: "POST", path: `/sessions/${ID}/finish` });
  });
  it("says not_found when the window has gone", async () => {
    fake.behaviour.finish = "gone";
    expect(await client().finishSession(ID)).toEqual({ ok: false, reason: "not_found" });
  });
  it("says failed for a broken answer or a session that is not one, and unavailable when nothing answers", async () => {
    fake.behaviour.finish = "fail";
    expect(await client().finishSession(ID)).toEqual({ ok: false, reason: "failed" });
    fake.behaviour.finish = "garbage";
    expect(await client().finishSession(ID)).toEqual({ ok: false, reason: "failed" });
    expect(await client({ baseUrl: "http://127.0.0.1:1" }).finishSession(ID)).toEqual({ ok: false, reason: "unavailable" });
  });
  it("only ever asks about a window id that looks like one", async () => {
    expect(await client().finishSession("../verify")).toEqual({ ok: false, reason: "not_found" });
    expect(fake.requests).toHaveLength(0);
  });
});

describe("cancelSession", () => {
  it("cancels", async () => {
    expect(await client().cancelSession(ID)).toEqual({ ok: true });
    expect(fake.requests[0]).toMatchObject({ method: "DELETE", path: `/sessions/${ID}` });
  });
  it("says not_found when the window has gone, and unavailable when nothing answers", async () => {
    fake.behaviour.cancel = "gone";
    expect(await client().cancelSession(ID)).toEqual({ ok: false, reason: "not_found" });
    expect(await client({ baseUrl: "http://127.0.0.1:1" }).cancelSession(ID)).toEqual({ ok: false, reason: "unavailable" });
  });
  it("only ever asks about a window id that looks like one", async () => {
    expect(await client().cancelSession("../verify")).toEqual({ ok: false, reason: "not_found" });
    expect(fake.requests).toHaveLength(0);
  });
});
