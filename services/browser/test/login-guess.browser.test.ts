// The login guesses a button or an opener by what it says, against real Chromium and a local site with one login shape per path.
// Not Linux-gated: it drives a plain page with runLogin, with no profile.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { chromium, type Browser } from "playwright";
import { runLogin, type LoginRequest, type LoginResult } from "../src/login.js";

vi.setConfig({ testTimeout: 90_000, hookTimeout: 60_000 });

const USER = "buyer@example.test";
const PASSWORD = "correct horse";
const FILLER = "Welcome back. ".repeat(30);
const hits: Record<string, number> = {};
const posts: Record<string, URLSearchParams[]> = {};

const page = (body: string) => `<!doctype html><html><head><meta charset="utf-8"><title>Supplier</title></head><body>${body}</body></html>`;
const fields = '<label>Email <input type="email" name="username"></label><label>Password <input type="password" name="password"></label>';
const loginForm = (kase: string, control: string, extra = "") => `<form method="post" action="/${kase}/do">${extra}${fields}${control}</form>`;
/** A button that sends the form without being a submit button, so only guessing can find it. */
const plain = (text: string) => `<button type="button" onclick="this.form.submit()">${text}</button>`;

const body = (req: IncomingMessage) => new Promise<URLSearchParams>((resolve) => {
  let text = "";
  req.on("data", (c) => (text += c));
  req.on("end", () => resolve(new URLSearchParams(text)));
});
const cookie = (req: IncomingMessage) => /sid=ok/.test(req.headers.cookie ?? "");

const PAGES: Record<string, string> = {
  "button-outside-submit": loginForm("button-outside-submit", plain("login to your account")),
  "link-button": loginForm("link-button", '<a class="btn" role="button" href="#" onclick="document.forms[0].submit();return false">Sign in securely</a>'),
  "forgot-and-login": loginForm(
    "forgot-and-login",
    '<a href="/forgot-and-login/forgot">Forgot password</a><button type="button" onclick="fetch(\'/forgot-and-login/register\')">Register</button>' + plain("Access my account"),
  ),
  "newsletter-neighbour":
    '<input type="search" name="q"><form action="/newsletter-neighbour/news"><input type="email" name="news"><button type="button" onclick="fetch(\'/newsletter-neighbour/subscribed\')">Subscribe</button></form>' +
    loginForm("newsletter-neighbour", plain("Enter portal")),
  "only-signup": loginForm("only-signup", '<button type="button">Sign up</button>'),
  // The login is behind an opener that is not on the word list.
  "long-opener": `<header><a href="/long-opener/register">Register</a><a href="#" onclick="document.getElementById('f').style.display='block';return false">Customer login</a></header><div id="f" style="display:none">${loginForm("long-opener", '<button type="submit">Sign in</button>')}</div>`,
  "icon-link-opener": '<header><a href="/icon-link-opener/account"><svg width="16" height="16"><circle cx="8" cy="8" r="6"/></svg></a></header><p>Welcome to our shop.</p>',
  "popup-form": `<button onclick="const m=document.getElementById('m');m.style.display='block';setTimeout(()=>{m.style.opacity=1},700)">My account area</button><div id="m" style="display:none;opacity:0;transition:opacity 200ms">${loginForm("popup-form", '<button type="submit">Sign in</button>')}</div>`,
  "two-step-popup": `<button onclick="document.getElementById('m').style.display='block'">Customer login</button><div id="m" style="display:none"><form method="post" action="/two-step-popup/do"><label>Email <input type="email" name="username"></label><div id="pw" style="display:none"><label>Password <input type="password" name="password"></label></div><button type="button" onclick="document.getElementById('pw').style.display='block';this.style.display='none';document.getElementById('s').style.display='inline-block'">Continue</button><button id="s" type="submit" style="display:none">Sign in</button></form></div>`,
  // Header icons with no words: one goes to Register, one to Log out. Neither may be taken for the opener.
  "icon-links": '<header><a href="/icon-links/account/register"><svg width="16" height="16"><circle cx="8" cy="8" r="6"/></svg></a><a href="/icon-links/account/logout"><svg width="16" height="16"><rect width="12" height="12"/></svg></a></header><p>Welcome to our shop.</p>',
  "logout-only": '<header><a href="/logout-only/logout">Log out</a><a href="/logout-only/register">Register</a></header><p>Welcome to our shop.</p>',
};
/** Pages other than a login page, by path. */
const ROUTES: Record<string, string> = { "icon-link-opener/account": loginForm("icon-link-opener", '<button type="submit">Sign in</button>') };

let site: Server;
let base = "";
let browser: Browser;

beforeAll(async () => {
  site = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    hits[url.pathname] = (hits[url.pathname] ?? 0) + 1;
    const html = (text: string, status = 200) => res.writeHead(status, { "content-type": "text/html" }).end(text);
    if (url.pathname === "/account") return cookie(req) ? html(page(`<h1>Your account</h1><p>${FILLER}</p>`)) : res.writeHead(302, { location: "/button-outside-submit/login" }).end();
    const [, kase = "", step = ""] = url.pathname.split("/");
    if (step === "do" && req.method === "POST") {
      const b = await body(req);
      (posts[kase] ??= []).push(b);
      if (b.get("username") === USER && b.get("password") === PASSWORD) return res.writeHead(302, { "set-cookie": "sid=ok; Path=/", location: "/account" }).end();
      return html(page("<p>Wrong password.</p>"));
    }
    const route = ROUTES[`${kase}/${step}`] ?? (step === "login" ? PAGES[kase] : undefined);
    if (route) return html(page(route));
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

const ask = (kase: string, extra: Partial<LoginRequest> = {}): LoginRequest => ({ loginUrl: `${base}/${kase}/login`, checkUrl: `${base}/account`, username: USER, password: PASSWORD, stealth: false, ...extra });
async function login(kase: string): Promise<{ result: LoginResult; why: string }> {
  const context = await browser.newContext();
  try {
    let why = "";
    const result = await runLogin(await context.newPage(), ask(kase), { settleMs: 1500, stepWaitMs: 4000, formWaitMs: 4000, onWhy: (w) => (why = w) });
    return { result, why };
  } finally {
    await context.close();
  }
}

describe("guessing the login button", () => {
  it("presses a button that is not a submit control and not on the word list", async () => {
    const r = await login("button-outside-submit");
    expect(r.result, r.why).toBe("ok");
  });
  it("presses a link styled as a button", async () => {
    const r = await login("link-button");
    expect(r.result, r.why).toBe("ok");
  });
  it("never presses Forgot password or Register beside the login button", async () => {
    const r = await login("forgot-and-login");
    expect(r.result, r.why).toBe("ok");
    expect(hits["/forgot-and-login/forgot"]).toBeUndefined();
    expect(hits["/forgot-and-login/register"]).toBeUndefined();
  });
  it("uses the button of the login's own form, not a newsletter box beside it", async () => {
    const r = await login("newsletter-neighbour");
    expect(r.result, r.why).toBe("ok");
    expect(hits["/newsletter-neighbour/subscribed"]).toBeUndefined();
    expect(posts["newsletter-neighbour"]).toHaveLength(1);
  });
  it("presses nothing when the only control is Sign up", async () => {
    const r = await login("only-signup");
    expect(r.result).not.toBe("ok");
    expect(posts["only-signup"]).toBeUndefined();
  });
});

describe("guessing the opener", () => {
  it("opens a login behind a link that says more than Log in", async () => {
    const r = await login("long-opener");
    expect(r.result, r.why).toBe("ok");
    expect(hits["/long-opener/register"]).toBeUndefined();
  });
  it("follows a link with no words whose address is the account page", async () => {
    const r = await login("icon-link-opener");
    expect(r.result, r.why).toBe("ok");
  });
  it("waits for a popup form that fades in", async () => {
    const r = await login("popup-form");
    expect(r.result, r.why).toBe("ok");
  });
  it("goes through a two-step form inside a popup", async () => {
    const r = await login("two-step-popup");
    expect(r.result, r.why).toBe("ok");
  });
  it("never takes an icon link to Register or Log out for an opener", async () => {
    const r = await login("icon-links");
    expect(r.result).toBe("form_not_found");
    expect(r.why).toMatch(/^no_opener/);
    expect(hits["/icon-links/account/register"]).toBeUndefined();
    expect(hits["/icon-links/account/logout"]).toBeUndefined();
  });
  it("never takes Log out or Register for an opener", async () => {
    const r = await login("logout-only");
    expect(r.result).toBe("form_not_found");
    expect(r.why).toMatch(/^no_opener/);
    expect(hits["/logout-only/logout"]).toBeUndefined();
    expect(hits["/logout-only/register"]).toBeUndefined();
  });
});
