// Run by login-tsx.browser.test.ts under tsx, the way the container runs the service. tsx wraps named inner functions in __name(),
// which does not exist inside a web page; vitest does not, so only a run under tsx can catch a login that cannot read its page.
// A small login server, the owner's own kind of settings (the username and password boxes picked by id), and the real runLogin.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { chromium } from "playwright";
import { driverFor } from "../src/driver.js";
import { runLogin } from "../src/login.js";
import { shimPage } from "../src/page-shim.js";

const USER = "buyer@example.test";
const PASSWORD = "correct horse";
const posts: string[] = [];
const filler = "Trade supplies for shops, bars and kitchens. ".repeat(8);
const server = createServer((req, res) => {
  const html = (body: string, headers: Record<string, string> = {}) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", ...headers });
    res.end(`<!doctype html><title>Trade</title><body>${body}</body>`);
  };
  if (req.method === "POST" && req.url === "/Account/Login") {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const form = new URLSearchParams(raw);
      posts.push(`${form.get("UserName") === USER}/${form.get("Password") === PASSWORD}`);
      if (form.get("UserName") === USER && form.get("Password") === PASSWORD) {
        res.writeHead(302, { location: "/account", "set-cookie": "sid=1; Path=/" });
        return void res.end();
      }
      html(`<p>Wrong login.</p>${form_()}`);
    });
    return;
  }
  if (req.url === "/account") {
    if (!(req.headers.cookie ?? "").includes("sid=1")) {
      res.writeHead(302, { location: "/Account/Login" });
      return void res.end();
    }
    return html(`<h1>Your account</h1><p>${filler}</p><a href="/out">Log out</a>`);
  }
  html(`<h1>Login or create an account</h1><p>${filler}</p>${form_()}`);
});
const form_ = () =>
  `<form method="post" action="/Account/Login"><label>Username <input type="email" id="UserName" name="UserName"></label>` +
  `<label>Password <input type="password" id="Password" name="Password"></label><button type="submit" id="go">Login</button></form>`;

await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
// PROBE_STEALTH=1: the way a stealth login runs. Chromium is started on its own and Patchright attaches to it, so the page
// scripts run in an isolated world that the page's own scripts never reach.
const stealth = process.env.PROBE_STEALTH === "1";
const browser = await chromium.launch({ args: [...(process.env.CI ? ["--no-sandbox"] : []), ...(stealth ? ["--remote-debugging-port=9339"] : [])] });
try {
  let page;
  if (stealth) {
    const cdp = await (await driverFor(true)).connectOverCDP("http://127.0.0.1:9339");
    const context = cdp.contexts()[0];
    page = context?.pages()[0] ?? (await context?.newPage());
    if (!page) throw new Error("no page");
    if (process.env.PROBE_NO_SHIM !== "1") shimPage(page);
  } else page = await browser.newPage();
  const why: string[] = [];
  const result = await runLogin(
    page,
    { loginUrl: `${base}/Account/Login`, checkUrl: `${base}/account`, username: USER, password: PASSWORD, stealth, selectors: { username: "#UserName", password: "#Password" } },
    { settleMs: 2000, formWaitMs: 3000, onWhy: (w) => why.push(w) },
  );
  // A tripwire for the shim: in a bare page, with no shim, a function with a named inner function must still fail under tsx. If it
  // stops failing, tsx no longer wraps names, and the shim can be removed on purpose instead of lingering by habit.
  const bare = await browser.newPage();
  const bareFails = await bare
    .evaluate(() => {
      const named = (n: number) => n + 1;
      return named(1);
    })
    .then(
      () => false,
      (e: unknown) => /__name is not defined/.test(String(e)),
    );
  console.log(JSON.stringify({ result, why, posts, bareFails }));
} finally {
  await browser.close();
  server.close();
}
