// Real Chromium against the fake supplier, through the service's own HTTP interface.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakeSupplier, FAKE_PASSWORD, FAKE_USERNAME, type FakeSupplier } from "@stock-monitor/supplier-session/testing";
import { startBrowserService, type BrowserService } from "../src/service.js";

const TOKEN = "b".repeat(40);
let site: FakeSupplier;
let service: BrowserService;
let internal: Server;
let internalHits = 0;
let deadOrigin: string;

const listen = (server: Server) => new Promise<number>((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)));

beforeAll(async () => {
  site = await createFakeSupplier();
  internal = createServer((_req, res) => {
    internalHits += 1;
    res.end("secret internal service");
  });
  const internalPort = await listen(internal);
  // An address nothing listens on, to get a real "connection refused".
  const probe = createServer();
  const deadPort = await listen(probe);
  await new Promise((resolve) => probe.close(resolve));
  deadOrigin = `http://127.0.0.1:${deadPort}`;
  internalUrl = `http://127.0.0.1:${internalPort}`;

  service = await startBrowserService({
    token: TOKEN,
    port: 0,
    host: "127.0.0.1",
    navigationTimeoutMs: 2000,
    // GitHub's runners do not allow Chromium's sandbox without extra setup. The container and real servers keep it on.
    sandbox: !process.env.CI,
    // Only the fake supplier and the dead address are let through. Everything else on this machine, including the "internal" server, stays blocked.
    guard: {
      allowHosts: [`127.0.0.1:${site.port}`, new URL(deadOrigin).host],
      lookup: async (host) => (host === "internal.test" ? ["10.0.0.5"] : host === "ghost.test" ? Promise.reject(new Error("ENOTFOUND")) : ["93.184.216.34"]),
    },
  });
}, 60_000);
let internalUrl = "";
afterAll(async () => {
  await service?.close();
  await site?.close();
  await new Promise((resolve) => internal?.close(resolve));
});
beforeEach(() => {
  site.expireSessions();
  site.requests.length = 0;
  internalHits = 0;
});

const loginState = async () => {
  const res = await fetch(`${site.url}/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: FAKE_USERNAME, password: FAKE_PASSWORD }),
  });
  const value = /supplier_session=([0-9a-f]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1] ?? "";
  const host = new URL(site.url).hostname;
  return { value, state: { cookies: [{ name: "supplier_session", value, domain: host, path: "/", expires: -1, httpOnly: true, secure: false, sameSite: "Lax" }], origins: [] } };
};
const empty = { cookies: [], origins: [] };
const verify = async (url: string, state: unknown = empty, extra: Record<string, unknown> = {}) => {
  const res = await fetch(`${service.url}/verify`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ url, state, ...extra }),
  });
  return { status: res.status, text: await res.clone().text(), body: (await res.json()) as { result: string; status: number | null; blockedRequests: number } };
};

describe("a saved login", () => {
  it("reaches the account page that needs a login and is read as ok", async () => {
    const { state } = await loginState();
    const r = await verify(`${site.url}/account`, state);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ result: "ok", status: 200, blockedRequests: 0 });
  });

  it("is sent to the login page by a fresh context with no saved state", async () => {
    expect((await verify(`${site.url}/account`)).body.result).toBe("login_required");
  });

  it("is sent to the login page after the supplier expires the session", async () => {
    const { state } = await loginState();
    expect((await verify(`${site.url}/account`, state)).body.result).toBe("ok");
    site.expireSessions();
    expect((await verify(`${site.url}/account`, state)).body.result).toBe("login_required");
  });

  it("tells a product page with hidden prices from one with prices", async () => {
    const { state } = await loginState();
    expect((await verify(`${site.url}/products/blue-widget`)).body.result).toBe("login_required");
    expect((await verify(`${site.url}/products/blue-widget`, state)).body.result).toBe("ok");
  });

  it("uses the owner's login address when the page itself does not look like a login", async () => {
    const r = await verify(`${site.url}/products/red-gadget`, (await loginState()).state, { loginUrl: `${site.url}/products/red-gadget` });
    expect(r.body.result).toBe("login_required");
  });
});

describe("pages that need attention", () => {
  it("does not mistake a hidden sign-in popup or an invisible spam guard for a wall", async () => {
    const r = await verify(`${site.url}/product-with-hidden-guards`);
    expect(r.body.result).toBe("ok");
  });
  it.each([["recaptcha"], ["hcaptcha"], ["turnstile"]])("reads the %s challenge page as a captcha", async (widget) => {
    expect((await verify(`${site.url}/captcha?widget=${widget}`)).body.result).toBe("captcha");
  });

  it("reads a 403 as blocked and a 429 as blocked", async () => {
    const a = await verify(`${site.url}/blocked`);
    expect(a.body).toMatchObject({ result: "blocked", status: 403 });
    expect((await verify(`${site.url}/rate-limited`)).body).toMatchObject({ result: "blocked", status: 429 });
  });

  it("reads a page that does not exist as unknown, not ok", async () => {
    expect((await verify(`${site.url}/nothing-here`)).body.result).toBe("unknown");
  });

  it("reads a page that takes too long as unreachable", async () => {
    expect((await verify(`${site.url}/slow?ms=10000`)).body.result).toBe("unreachable");
  });

  it("reads a refused connection as unreachable", async () => {
    expect((await verify(`${deadOrigin}/`)).body.result).toBe("unreachable");
  });

  it("reads a name that cannot be found as unreachable", async () => {
    expect((await verify("http://ghost.test/")).body.result).toBe("unreachable");
  });
});

describe("addresses on private networks are blocked", () => {
  it.each(["metadata", "loopback", "private"])("a redirect to the %s address is blocked and reads as unknown", async (kind) => {
    const r = await verify(`${site.url}/redirect/${kind}`);
    expect(r.body.result).toBe("unknown");
    expect(r.body.blockedRequests).toBeGreaterThanOrEqual(1);
  });

  it("never reaches an internal server that a redirect points at", async () => {
    const r = await verify(`${site.url}/redirect-to?url=${encodeURIComponent(`${internalUrl}/hit`)}`);
    expect(r.body.result).toBe("unknown");
    expect(internalHits).toBe(0);
  });

  it("refuses to open an internal server asked for directly", async () => {
    expect((await verify(`${internalUrl}/hit`)).body.result).toBe("unknown");
    expect(internalHits).toBe(0);
  });

  it("refuses a name that resolves to a private address", async () => {
    const r = await verify("http://internal.test/");
    expect(r.body).toMatchObject({ result: "unknown", blockedRequests: 1 });
  });

  it("blocks an image and a WebSocket on a private address inside a normal page, and the page still loads", async () => {
    const r = await verify(`${site.url}/embeds-private`);
    expect(r.body.result).toBe("ok");
    expect(r.body.blockedRequests).toBeGreaterThanOrEqual(2);
  });

  it("does not follow a link to a private address, because nothing clicks it", async () => {
    expect((await verify(`${site.url}/links-private`)).body.blockedRequests).toBe(0);
  });
});

describe("the saved session stays in memory", () => {
  it("is never echoed in an answer", async () => {
    const { state, value } = await loginState();
    const r = await verify(`${site.url}/account`, state);
    expect(r.text).not.toContain(value);
  });

  it("is not written to any file the browser keeps", async () => {
    const { state, value } = await loginState();
    await verify(`${site.url}/account`, state);
    await verify(`${site.url}/products/blue-widget`, state);
    const hits: string[] = [];
    const scan = (dir: string, depth = 0) => {
      if (depth > 8) return;
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        let info;
        try {
          info = statSync(path);
        } catch {
          continue; // a file that vanished while scanning
        }
        if (info.isDirectory()) scan(path, depth + 1);
        else if (info.isFile() && info.size < 50_000_000 && readFileSync(path).includes(value)) hits.push(path);
      }
    };
    for (const name of readdirSync(tmpdir())) if (/playwright|chromium/i.test(name)) scan(join(tmpdir(), name));
    expect(hits).toEqual([]);
  });
});

describe("the control token", () => {
  it("is needed for a real check too", async () => {
    const res = await fetch(`${service.url}/verify`, { method: "POST", body: JSON.stringify({ url: `${site.url}/account`, state: empty }) });
    expect(res.status).toBe(401);
    expect(site.requests.filter((r) => r.path === "/account")).toHaveLength(0);
  });
});

describe("POST /check-page (real Chromium, fake supplier)", () => {
  const check = async (path: string, state: unknown = empty) => {
    const res = await fetch(`${service.url}/check-page`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ url: `${site.url}${path}`, state }),
    });
    return { status: res.status, body: (await res.json()) as { result: string; status: number | null; finalUrl: string | null; title: string | null; heading: string | null; softNotFound: boolean } };
  };

  it("reads the title, heading and address of a normal page", async () => {
    const { body } = await check("/products/blue-widget", (await loginState()).state);
    expect(body).toMatchObject({ result: "ok", status: 200, title: "Blue Widget 12 pack | Fake Supplier", heading: "Blue Widget 12 pack", softNotFound: false });
    expect(new URL(body.finalUrl as string).pathname).toBe("/products/blue-widget");
  });

  it("never returns the query string, which can hold a secret", async () => {
    const { body } = await check("/products/blue-widget?token=SECRET-VALUE");
    expect(JSON.stringify(body)).not.toContain("SECRET-VALUE");
    expect(body.finalUrl).not.toContain("?");
  });

  it.each([
    ["/products/nothing", 404, true],
    ["/gone410", 410, true],
    ["/soft404", 200, true],
  ])("sees %s as gone", async (path, status, softNotFound) => {
    const { body } = await check(path);
    expect(body.status).toBe(status);
    expect(body.softNotFound).toBe(softNotFound);
  });

  it("follows a redirect to the home page and says where it ended", async () => {
    const { body } = await check("/redirect-home");
    expect(new URL(body.finalUrl as string).pathname).toBe("/");
  });

  it("follows a redirect to a category", async () => {
    const { body } = await check("/redirect-category");
    expect(new URL(body.finalUrl as string).pathname).toBe("/collections/widgets");
  });

  it("says a different page title when the page was renamed", async () => {
    expect((await check("/renamed")).body.title).toBe("Red Gadget | Fake Supplier");
  });

  it("a supplier that cannot be reached is unreachable, so the link is never judged", async () => {
    const res = await fetch(`${service.url}/check-page`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ url: `${deadOrigin}/p`, state: empty }),
    });
    expect(await res.json()).toMatchObject({ result: "unreachable", softNotFound: false });
  });
});

describe("POST /capture (real Chromium, fake supplier)", () => {
  type Described = { result: string; status: number | null; finalUrl: string | null; title: string | null; description: { sections: { heading: string | null; level: number; lines: string[] }[]; buttons: { label: string; enabled: boolean; section: string | null }[] }; picture: string | null };
  const capture = async (path: string, picture = false) => {
    const res = await fetch(`${service.url}/capture`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ url: `${site.url}${path}`, state: empty, picture }),
    });
    const text = await res.text();
    return { status: res.status, text, body: JSON.parse(text) as Described };
  };

  it("describes a page: headings with their lines, and the buttons", async () => {
    const { body } = await capture("/stock/in");
    expect(body.result).toBe("ok");
    expect(body.description.sections[0]).toMatchObject({ heading: "Blue Tee", level: 1 });
    expect(body.description.sections[0]?.lines).toContain("Soft cotton.");
    expect(body.description.buttons).toEqual([{ label: "Add to cart", enabled: true, section: "Blue Tee" }]);
  });

  it("says a disabled button is disabled", async () => {
    const { body } = await capture("/stock/sold-out");
    expect(body.description.buttons).toEqual([{ label: "Add to cart", enabled: false, section: "Blue Tee" }]);
    expect(body.description.sections[0]?.lines).toContain("Sold out");
  });

  it("keeps a table row together, with its cells apart, under its own heading", async () => {
    const { body } = await capture("/stock/region");
    const table = body.description.sections.find((s) => s.heading === "Click and collect availability");
    expect(table).toMatchObject({ level: 2 });
    expect(table?.lines).toEqual(["Loughborough\t46", "Sheffield\t22", "Cardiff\t0"]);
  });

  it("puts a related product's text under its own heading", async () => {
    const { body } = await capture("/stock/related-sold-out");
    const related = body.description.sections.find((s) => s.heading === "You may also like");
    expect(related?.lines).toContain("Sold out");
    expect(body.description.sections[0]?.lines).not.toContain("Sold out");
  });

  it("never returns form values, hidden text, scripts, styles or cookies", async () => {
    const { text } = await capture("/stock/form", true);
    for (const secret of ["TYPED-SECRET-VALUE", "HIDDEN-MARKER", "TEXTAREA-SECRET", "SELECT-SECRET", "SCRIPT-MARKER", "STYLE-MARKER", "HIDDEN-TEXT", "DISPLAY-NONE-TEXT", "NOSCRIPT-TEXT", "COOKIE-MARKER"]) {
      expect(text, secret).not.toContain(secret);
    }
    expect(text).toContain("Visible text");
  });

  it("takes a picture only when asked, and it is a PNG", async () => {
    expect((await capture("/stock/in")).body.picture).toBeNull();
    const { body } = await capture("/stock/in", true);
    expect(Buffer.from(body.picture as string, "base64").subarray(1, 4).toString()).toBe("PNG");
  });

  it("caps a huge page instead of failing", async () => {
    const { status, body, text } = await capture("/stock/huge");
    expect(status).toBe(200);
    expect(body.description.buttons.length).toBeLessThanOrEqual(500);
    expect(body.description.sections.flatMap((s) => s.lines).length).toBeLessThanOrEqual(5000);
    expect(body.description.sections.flatMap((s) => s.lines).every((l) => l.length <= 2000)).toBe(true);
    expect(text.length).toBeLessThan(1_500_000);
  });

  it("reports the status, class and address like a link check, without the query string", async () => {
    const { body } = await capture("/stock/in?token=SECRET-VALUE");
    expect(JSON.stringify(body)).not.toContain("SECRET-VALUE");
    expect(body).toMatchObject({ status: 200, title: "Blue Tee | Fake Supplier" });
  });

  it("a missing page is described too, with its status", async () => {
    const { body } = await capture("/stock/nothing-here");
    expect(body.status).toBe(404);
  });

  it("never visits a private address", async () => {
    const res = await fetch(`${service.url}/capture`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ url: `${internalUrl}/secret`, state: empty, picture: true }),
    });
    expect(await res.text()).not.toContain("secret internal service");
    expect(internalHits).toBe(0);
  });

  it("needs the control token", async () => {
    const res = await fetch(`${service.url}/capture`, { method: "POST", body: JSON.stringify({ url: `${site.url}/stock/in`, state: empty }) });
    expect(res.status).toBe(401);
  });
});
