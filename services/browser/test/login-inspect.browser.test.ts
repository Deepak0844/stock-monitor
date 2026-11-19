// "Check login page": what a login would use and what else is on the page, against real Chromium and a local site.
// Nothing is typed or sent. Not Linux-gated: it drives a plain page, with no profile.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { chromium, type Browser, type Page } from "playwright";
import { runLogin, type LoginRequest } from "../src/login.js";
import { inspectLogin, type LoginInspection } from "../src/login-inspect.js";

vi.setConfig({ testTimeout: 90_000, hookTimeout: 60_000 });

const USER = "buyer@example.test";
const PASSWORD = "correct horse";
const FILLER = "Welcome back. ".repeat(30);
const posts: string[] = [];

const page = (body: string) => `<!doctype html><html><head><meta charset="utf-8"><title>Supplier</title></head><body>${body}</body></html>`;
// The login form, with a hidden twin of its boxes the way some shops keep a mobile copy, and a search box beside it.
const form = (action: string, control: string) =>
  `<input type="search" name="q" placeholder="Search"><form method="post" action="${action}"><label for="UserName">Email</label><input type="text" id="UserName" name="UserName"><label for="Password">Password</label><input type="password" id="Password" name="Password">${control}</form><div style="display:none"><input type="text" id="UserName" name="UserName"><input type="password" id="Password" name="Password"></div>`;
const duplicate = '<button type="button" onclick="this.form.submit()">Submit</button><button type="button" onclick="this.form.submit()">Submit</button>';

const PAGES: Record<string, string> = {
  form: form("/form/do", '<button type="button" id="dupbtn" onclick="this.form.submit()">login to your account</button><a href="/form/forgot">Forgot password</a>'),
  opener: `<header><a href="#" onclick="document.getElementById('f').style.display='block';return false">Customer login</a></header><div id="f" style="display:none">${form("/opener/do", '<button type="submit">Sign in</button>')}</div>`,
  none: "<p>Welcome to our shop. Nothing to sign in to here.</p>",
  captcha: '<div class="g-recaptcha" style="width:300px;height:80px">x</div>',
  twins: form("/twins/do", duplicate),
  noopener: '<header><a href="#" onclick="return false">Customer login</a></header><p>Welcome.</p>',
};

let site: Server;
let base = "";
let browser: Browser;

const bodyOf = (req: IncomingMessage) => new Promise<string>((resolve) => {
  let text = "";
  req.on("data", (c) => (text += c));
  req.on("end", () => resolve(text));
});

beforeAll(async () => {
  site = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const html = (text: string, status = 200) => res.writeHead(status, { "content-type": "text/html" }).end(text);
    if (url.pathname === "/account") return /sid=ok/.test(req.headers.cookie ?? "") ? html(page(`<h1>Your account</h1><p>${FILLER}</p>`)) : html(page("<p>Hello.</p>"));
    const [, kase = "", step = ""] = url.pathname.split("/");
    if (step === "do" && req.method === "POST") {
      const b = new URLSearchParams(await bodyOf(req));
      posts.push(`${kase}:${b.get("UserName") ?? ""}`);
      if (b.get("UserName") === USER && b.get("Password") === PASSWORD) return res.writeHead(302, { "set-cookie": "sid=ok; Path=/", location: "/account" }).end();
      return html(page("<p>Wrong.</p>"));
    }
    // A page that takes far longer than the check will wait.
    if (kase === "hang" && step === "login") return void setTimeout(() => html(page("late")), 5000);
    if (kase === "redirect" && step === "login") return res.writeHead(302, { location: "/account" }).end();
    if (step === "login" && PAGES[kase]) return html(page(PAGES[kase] as string));
    return html(page("not here"), 404);
  });
  await new Promise<void>((r) => site.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
  browser = await chromium.launch({ args: process.env.CI ? ["--no-sandbox"] : [] });
});
afterAll(async () => {
  await browser?.close();
  await new Promise((r) => (site ? site.close(r) : r(null)));
});

const inspect = async (kase: string, selectors?: LoginRequest["selectors"]): Promise<{ result: LoginInspection; page: Page; close: () => Promise<void> }> => {
  const context = await browser.newContext();
  const p = await context.newPage();
  const result = await inspectLogin(p, { loginUrl: `${base}/${kase}/login`, checkUrl: `${base}/account`, stealth: false, ...(selectors ? { selectors } : {}) }, { formWaitMs: 3000, stepWaitMs: 3000 });
  return { result, page: p, close: () => context.close() };
};

describe("inspecting a login page", () => {
  it("says what a login would use, by label", async () => {
    const { result, close } = await inspect("form");
    expect(result).toMatchObject({ state: "form", opened: false });
    expect(result.found.username).toEqual({ label: "Email", selector: "#UserName" });
    expect(result.found.password).toEqual({ label: "Password", selector: "#Password" });
    expect(result.found.submit).toEqual({ label: "login to your account", selector: "#dupbtn" });
    expect(result.found.open).toBeNull();
    expect(result.found.account).toBeNull();
    // Every visible candidate, and only those: the hidden twin boxes are not listed.
    expect(result.fields.map((f) => f.label)).toEqual(expect.arrayContaining(["Email", "Password"]));
    expect(result.fields).toHaveLength(2);
    expect(result.buttons.map((b) => b.label)).toEqual(expect.arrayContaining(["login to your account", "Forgot password"]));
    await close();
  });

  it("clicks the opener once and reports it, listing candidates from before and after the click", async () => {
    const { result, close } = await inspect("opener");
    expect(result).toMatchObject({ state: "form", opened: true });
    expect(result.found.open?.label).toBe("Customer login");
    expect(result.found.username).not.toBeNull();
    expect(result.buttons.map((b) => b.label)).toEqual(expect.arrayContaining(["Customer login", "Sign in"]));
    await close();
  });

  it("says opener when the click shows no form", async () => {
    const { result, close } = await inspect("noopener");
    expect(result).toMatchObject({ state: "opener", opened: true, fields: [] });
    expect(result.found.open?.label).toBe("Customer login");
    await close();
  });

  it("types nothing and sends nothing", async () => {
    const { page, close } = await inspect("form");
    expect(posts).toEqual([]);
    expect(await page.locator("input:visible").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))).toEqual(["", "", ""]);
    await close();
  });

  it("finds no form and no opener: state none, empty lists", async () => {
    const { result, close } = await inspect("none");
    expect(result).toMatchObject({ state: "none", opened: false, fields: [], buttons: [] });
    expect(Object.values(result.found).every((f) => f === null)).toBe(true);
    await close();
  });

  it("a login address that redirects away (already logged in) is state none", async () => {
    const { result, close } = await inspect("redirect");
    expect(result.state).toBe("none");
    expect(result.fields).toEqual([]);
    await close();
  });

  it("a visible challenge is state captcha", async () => {
    const { result, close } = await inspect("captcha");
    expect(result.state).toBe("captcha");
    await close();
  });

  it("an address nobody answers is state unreachable", async () => {
    const context = await browser.newContext();
    const result = await inspectLogin(await context.newPage(), { loginUrl: "http://127.0.0.1:1/login", checkUrl: `${base}/account`, stealth: false }, { formWaitMs: 500, stepWaitMs: 500 });
    expect(result.state).toBe("unreachable");
    await context.close();
  });

  it("gives up at its own deadline, however long the page takes, and says unreachable", async () => {
    const context = await browser.newContext();
    const started = Date.now();
    const result = await inspectLogin(await context.newPage(), { loginUrl: `${base}/hang/login`, checkUrl: `${base}/account`, stealth: false }, { deadlineMs: 600 });
    expect(result.state).toBe("unreachable");
    expect(Date.now() - started).toBeLessThan(3000);
    await context.close();
  });

  it("offers only controls whose selector matches exactly one visible control", async () => {
    const { result, page, close } = await inspect("twins");
    const all = [...Object.values(result.found).filter((c) => c !== null), ...result.fields, ...result.buttons];
    for (const c of all) expect(await page.locator(c.selector).filter({ visible: true }).count(), c.selector).toBe(1);
    // Two identical "Submit" buttons without ids cannot be told apart, so neither is offered.
    expect(result.buttons.map((b) => b.label)).not.toContain("Submit");
    await close();
  });

  it("the selectors it generates work in a real login on the same page", async () => {
    const { result, close } = await inspect("form");
    await close();
    const context = await browser.newContext();
    const out = await runLogin(
      await context.newPage(),
      {
        loginUrl: `${base}/form/login`, checkUrl: `${base}/account`, username: USER, password: PASSWORD, stealth: false,
        selectors: { username: result.found.username?.selector as string, password: result.found.password?.selector as string, submit: result.found.submit?.selector as string },
      },
      { settleMs: 1500, stepWaitMs: 4000, formWaitMs: 4000 },
    );
    expect(out).toBe("ok");
    await context.close();
  });
});
