import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createGuard } from "./guard.js";
import { quickRead } from "./quick-read.js";

type Handler = (req: IncomingMessage, res: ServerResponse) => void;
let handler: Handler = (_req, res) => res.end();
let seen: IncomingMessage[] = [];
let other: Server;
let otherHits = 0;
let server: Server;
let base = "";
let otherPort = 0;

const listen = (s: Server) => new Promise<number>((resolve) => s.listen(0, "127.0.0.1", () => resolve((s.address() as AddressInfo).port)));
beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push(req);
    handler(req, res);
  });
  base = `http://127.0.0.1:${await listen(server)}`;
  other = createServer((_req, res) => {
    otherHits++;
    res.end("private");
  });
  otherPort = await listen(other);
});
afterAll(() => {
  server.closeAllConnections();
  server.close();
  other.close();
});
beforeEach(() => {
  seen = [];
  otherHits = 0;
});

const guard = () => createGuard({ allowHosts: [new URL(base).host] });
const read = (path = "/p/tee?x=1", over: Partial<Parameters<typeof quickRead>[1]> = {}) => quickRead(`${base}${path}`, { guard: guard(), ...over });
const html = (body: string, title = "Blue Tee") => `<!doctype html><html><head><title>${title}</title></head><body><h1>Blue Tee</h1>${body}<p>${"Soft cotton tee. ".repeat(30)}</p></body></html>`;
const product = (availability: string) => `<script type="application/ld+json">${JSON.stringify({ "@type": "Product", offers: { availability: `https://schema.org/${availability}` } })}</script>`;
const page = (body: string, status = 200, headers: Record<string, string> = {}): Handler => (_req, res) => {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers });
  res.end(body);
};

describe("quickRead", () => {
  it("reads the built-in offers of a page, and gives its address without the query", async () => {
    handler = page(html(product("InStock")));
    expect(await read()).toMatchObject({ result: "ok", status: 200, finalUrl: `${base}/p/tee`, softNotFound: false, blocked: false, offers: [{ availability: "InStock", url: null, sku: null, name: null }] });
  });

  it("sends an honest user agent, the language when given, and no cookie", async () => {
    handler = page(html(product("InStock")));
    await read("/p/tee", { language: "en-GB" });
    expect(seen[0]?.headers).toMatchObject({ "user-agent": "stock-monitor/1.0", "accept-language": "en-GB" });
    expect(seen[0]?.headers.cookie).toBeUndefined();
  });

  it("follows a redirect on the same site", async () => {
    handler = (req, res) => (req.url === "/old" ? res.writeHead(302, { location: "/p/tee" }).end() : page(html(product("OutOfStock")))(req, res));
    expect(await read("/old")).toMatchObject({ result: "ok", finalUrl: `${base}/p/tee`, offers: [{ availability: "OutOfStock" }] });
  });

  it("stops after 5 redirects", async () => {
    handler = (req, res) => res.writeHead(302, { location: `/r${Number(req.url?.slice(2) || 0) + 1}` }).end();
    expect(await read("/r0")).toMatchObject({ result: "unknown", signal: "too_many_redirects", offers: [] });
  });

  it("never follows a redirect to a private address, and never connects to it", async () => {
    handler = (_req, res) => res.writeHead(302, { location: `http://127.0.0.1:${otherPort}/secret` }).end();
    expect(await read("/p/tee")).toMatchObject({ result: "unknown", blocked: true, offers: [] });
    expect(otherHits).toBe(0);
  });

  it("never reads a private address it is given", async () => {
    expect(await quickRead(`http://127.0.0.1:${otherPort}/`, { guard: createGuard() })).toMatchObject({ result: "unknown", blocked: true });
    expect(otherHits).toBe(0);
  });

  it("stops a page bigger than the limit", async () => {
    handler = page(html("x".repeat(50_000)));
    expect(await read("/p/tee", { maxBytes: 10_000 })).toMatchObject({ result: "unknown", signal: "too_large", offers: [] });
  });

  it("stops a page that takes too long", async () => {
    handler = (_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.write("<html>");
    };
    expect(await read("/p/tee", { timeoutMs: 200 })).toMatchObject({ result: "unreachable", signal: "timeout", offers: [] });
  });

  it("reads a gzip and a brotli page", async () => {
    handler = page(gzipSync(html(product("InStock"))) as unknown as string, 200, { "content-encoding": "gzip" });
    expect((await read()).offers).toHaveLength(1);
    handler = page(brotliCompressSync(html(product("SoldOut"))) as unknown as string, 200, { "content-encoding": "br" });
    expect((await read()).offers).toEqual([{ availability: "SoldOut", url: null, sku: null, name: null }]);
  });

  it("reads only HTML", async () => {
    handler = page(JSON.stringify({ availability: "InStock" }), 200, { "content-type": "application/json" });
    expect(await read()).toMatchObject({ result: "unknown", signal: "not_html", offers: [] });
  });

  it("knows a login page, a puzzle and a block, as the browser would", async () => {
    handler = page(html(`${product("InStock")}<form><input type="password" name="p"></form>`));
    expect((await read()).result).toBe("login_required");
    handler = page(html(`${product("InStock")}<div class="h-captcha" data-sitekey="x"></div>`));
    expect((await read()).result).toBe("captcha");
    handler = page(html(product("InStock")), 403);
    expect((await read()).result).toBe("blocked");
    handler = page(html(product("InStock")), 401);
    expect((await read()).result).toBe("login_required");
    handler = page(html(product("InStock")), 503);
    expect((await read()).result).toBe("unreachable");
  });

  it("does not take login wording on a public page as a login wall, or a hidden password box as a form", async () => {
    handler = page(html(`${product("InStock")}<p>Please log in to see prices.</p><input type="hidden" name="password">`));
    expect((await read()).result).toBe("ok");
  });

  it("says a page is a not-found page from its title", async () => {
    handler = page(html("", "Page not found &amp; more"), 200);
    expect((await read()).softNotFound).toBe(true);
  });

  it("reads microdata availability", async () => {
    handler = page(html('<div itemscope><link itemprop="availability" href="https://schema.org/OutOfStock"></div>'));
    expect((await read()).offers).toEqual([{ availability: "OutOfStock", url: null, sku: null, name: null }]);
  });
});

describe("quickRead on hostile pages", () => {
  it.each([
    ["3 MB of unclosed tags", "<".repeat(2_900_000)],
    ["unclosed scripts", '<script type="application/ld+json">{'.repeat(70_000)],
    ["unclosed inputs", "<input type=password ".repeat(130_000)],
    ["unclosed styles", "<style>".repeat(400_000)],
  ])("reads %s in well under a second, without freezing the service", async (_what, body) => {
    handler = page(body);
    const started = Date.now();
    const out = await read("/p/tee", { maxBytes: 3_000_000 });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(out.offers).toEqual([]);
  });

  it("stops a compressed page that stalls halfway at the time limit", async () => {
    const zipped = gzipSync(html(product("InStock")));
    handler = (_req, res) => {
      res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
      res.write(zipped.subarray(0, 20));
    };
    const started = Date.now();
    expect(await read("/p/tee", { timeoutMs: 300 })).toMatchObject({ result: "unreachable", signal: "timeout" });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("stops downloading a redirect's body at once", async () => {
    let ended = false;
    handler = (req, res) => {
      if (req.url === "/big") {
        res.writeHead(302, { location: "/p/tee", "content-type": "text/plain" });
        const timer = setInterval(() => res.write("x".repeat(64_000)), 5);
        res.on("close", () => {
          clearInterval(timer);
          ended = true;
        });
        return;
      }
      page(html(product("InStock")))(req, res);
    };
    expect(await read("/big")).toMatchObject({ result: "ok" });
    await new Promise((r) => setTimeout(r, 100));
    expect(ended).toBe(true);
  });
});
