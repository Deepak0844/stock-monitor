// Control server inside the browser container. Only reachable from the proxy.
import http from "node:http";
import { chromium } from "playwright";

let browser;
let context;
let page;
const sandbox = process.env.NO_SANDBOX ? ["--no-sandbox"] : [];

const read = (req) => new Promise((resolve) => { let t = ""; req.on("data", (c) => (t += c)); req.on("end", () => resolve(t ? JSON.parse(t) : {})); });
const send = (res, code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (req.method === "POST" && url.pathname === "/open") {
      if (browser) return send(res, 409, { error: "a session is already open" });
      const { url: target } = await read(req);
      browser = await chromium.launch({ headless: false, args: ["--window-position=0,0", "--window-size=1280,800", ...sandbox] });
      context = await browser.newContext({ viewport: null });
      page = await context.newPage();
      await page.goto(target);
      return send(res, 200, { ok: true });
    }
    if (req.method === "POST" && url.pathname === "/goto") { const { url: u } = await read(req); await page.goto(u); return send(res, 200, { ok: true }); }
    if (req.method === "GET" && url.pathname === "/debug/url") return send(res, 200, { url: page.url() });
    if (req.method === "POST" && url.pathname === "/debug/focus") { const { selector } = await read(req); await page.focus(selector); return send(res, 200, { ok: true }); }
    if (req.method === "GET" && url.pathname === "/debug/value") return send(res, 200, { value: await page.inputValue(url.searchParams.get("selector")) });
    if (req.method === "GET" && url.pathname === "/debug/has") return send(res, 200, { count: await page.locator(url.searchParams.get("selector")).count() });
    if (req.method === "GET" && url.pathname === "/debug/info") return send(res, 200, { uid: process.getuid(), noSandboxFlag: sandbox.length > 0, chromium: browser?.version() });
    if (req.method === "POST" && url.pathname === "/finish") {
      const state = await context.storageState();
      await browser.close();
      browser = context = page = undefined;
      return send(res, 200, state);
    }
    if (req.method === "POST" && url.pathname === "/verify") {
      // A fresh headless context given the saved state in memory. Nothing is written to disk.
      const { url: target, state } = await read(req);
      const b = await chromium.launch({ headless: true, args: sandbox });
      try {
        const c = await b.newContext({ storageState: state });
        const p = await c.newPage();
        await p.goto(target);
        return send(res, 200, { finalUrl: p.url(), heading: (await p.locator("h1").first().textContent())?.trim() });
      } finally { await b.close(); }
    }
    send(res, 404, { error: "unknown" });
  } catch (e) { send(res, 500, { error: String(e.message ?? e).split("\n")[0] }); }
}).listen(8080, () => console.log("browser control on 8080"));
