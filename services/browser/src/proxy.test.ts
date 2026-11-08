import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { connect, type AddressInfo, type Socket } from "node:net";
import { createServer, request, type IncomingHttpHeaders, type Server } from "node:http";
import { startGuardProxy, type GuardProxy } from "./proxy.js";
import type { Guard } from "./guard.js";

let target: Server;
let targetPort: number;
let seenByTarget: { host?: string; url?: string; auth?: string; headers: IncomingHttpHeaders }[] = [];
let proxy: GuardProxy;
const consulted = vi.fn();

const guard: Guard = {
  check: async (host, port) => {
    consulted(host, port);
    if (host === "pinned.test") return { allowed: true, address: "127.0.0.1" };
    if (host === "evil.test") return { allowed: false, reason: "private" };
    return { allowed: false, reason: "not_found" };
  },
};

beforeAll(async () => {
  target = createServer((req, res) => {
    seenByTarget.push({ host: req.headers.host, url: req.url, auth: req.headers["proxy-authorization"] as string | undefined, headers: req.headers });
    res.setHeader("x-echo", "yes");
    res.end(`hello from the target: ${req.url}`);
  });
  await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
  targetPort = (target.address() as AddressInfo).port;
  proxy = await startGuardProxy(guard);
});
afterAll(async () => {
  await proxy.close();
  target.closeAllConnections();
  await new Promise((resolve) => target.close(resolve));
});

const basic = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
const viaProxy = (path: string, headers: Record<string, string> = {}) =>
  new Promise<{ status: number; body: string; headers: IncomingHttpHeaders }>((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: proxy.port, method: "GET", path, headers }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
    });
    req.on("error", reject);
    req.end();
  });
const asVerify = (id: string) => ({ "proxy-authorization": basic(id, proxy.secret) });

describe("who may use the proxy", () => {
  it("asks for credentials first, and does not look anything up for a caller without them", async () => {
    consulted.mockClear();
    const r = await viaProxy(`http://pinned.test:${targetPort}/`);
    expect(r.status).toBe(407);
    expect(r.headers["proxy-authenticate"]).toMatch(/^Basic/);
    expect(consulted).not.toHaveBeenCalled();
  });
  it("refuses the wrong password", async () => {
    expect((await viaProxy(`http://pinned.test:${targetPort}/`, { "proxy-authorization": basic("x", "wrong") })).status).toBe(407);
  });
});

describe("plain HTTP through the proxy", () => {
  it("connects to the address the guard checked, and keeps the original Host header", async () => {
    seenByTarget = [];
    const r = await viaProxy(`http://pinned.test:${targetPort}/hello?x=1`, { ...asVerify("v1"), host: `pinned.test:${targetPort}` });
    expect(r.status).toBe(200);
    expect(r.body).toBe("hello from the target: /hello?x=1");
    expect(r.headers["x-echo"]).toBe("yes");
    expect(seenByTarget[0]).toMatchObject({ host: `pinned.test:${targetPort}`, url: "/hello?x=1" });
  });

  it("does not pass the proxy's own credentials on to the site", async () => {
    seenByTarget = [];
    await viaProxy(`http://pinned.test:${targetPort}/`, asVerify("v1"));
    expect(seenByTarget[0]?.auth).toBeUndefined();
    expect(seenByTarget[0]?.headers["proxy-connection"]).toBeUndefined();
  });

  it("refuses a blocked target with 403 and never contacts anything", async () => {
    seenByTarget = [];
    const r = await viaProxy("http://evil.test/", asVerify("v2"));
    expect(r.status).toBe(403);
    expect(r.headers["x-guard-blocked"]).toBe("private");
    expect(seenByTarget).toHaveLength(0);
  });

  it("answers 502 for a name that cannot be found", async () => {
    expect((await viaProxy("http://ghost.test/", asVerify("v3"))).status).toBe(502);
  });
});

describe("tunnels (https and WebSocket) through the proxy", () => {
  const tunnel = (hostPort: string, id: string) =>
    new Promise<{ status: number; socket: Socket | null }>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port: proxy.port, method: "CONNECT", path: hostPort, headers: asVerify(id) });
      req.on("connect", (res, socket) => resolve({ status: res.statusCode ?? 0, socket }));
      req.on("response", (res) => resolve({ status: res.statusCode ?? 0, socket: null }));
      req.on("error", reject);
      req.end();
    });

  it("opens a tunnel to the checked address and passes bytes both ways", async () => {
    const { status, socket } = await tunnel(`pinned.test:${targetPort}`, "t1");
    expect(status).toBe(200);
    const reply = await new Promise<string>((resolve) => {
      let data = "";
      socket!.on("data", (c) => (data += c));
      socket!.on("end", () => resolve(data));
      socket!.write(`GET /inside HTTP/1.1\r\nHost: pinned.test\r\nConnection: close\r\n\r\n`);
    });
    expect(reply).toContain("hello from the target: /inside");
  });

  it("refuses a tunnel to a blocked target and reaches nothing", async () => {
    seenByTarget = [];
    const { status } = await tunnel("evil.test:443", "t2");
    expect(status).toBe(403);
    expect(seenByTarget).toHaveLength(0);
  });

  it("refuses a tunnel with no credentials", async () => {
    const result = await new Promise<number>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port: proxy.port, method: "CONNECT", path: `pinned.test:${targetPort}` });
      req.on("connect", (res) => resolve(res.statusCode ?? 0)); // Node reports any answer to CONNECT here
      req.on("error", reject);
      req.end();
    });
    expect(result).toBe(407);
  });
});

describe("telling one check from another", () => {
  it("counts what was refused for each check separately, and notes a refused private address", async () => {
    const a = proxy.track("check-a");
    const b = proxy.track("check-b");
    await viaProxy("http://evil.test/", asVerify("check-a"));
    await viaProxy("http://evil.test/", asVerify("check-a"));
    await viaProxy("http://ghost.test/", asVerify("check-b"));
    expect(a.blocked()).toEqual({ count: 2, privateAddress: true });
    expect(b.blocked()).toEqual({ count: 1, privateAddress: false });
    a.stop();
    b.stop();
  });

  it("stops counting once a check is finished", async () => {
    const t = proxy.track("check-c");
    t.stop();
    await viaProxy("http://evil.test/", asVerify("check-c"));
    expect(t.blocked().count).toBe(0);
  });
});

describe("stopping", () => {
  it("closes even with a tunnel open", async () => {
    const p = await startGuardProxy(guard);
    const socket = connect(p.port, "127.0.0.1");
    await new Promise((resolve) => socket.once("connect", resolve));
    const t0 = Date.now();
    await p.close();
    expect(Date.now() - t0).toBeLessThan(2000);
    socket.destroy();
  });
});
