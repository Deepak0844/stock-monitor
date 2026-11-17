// Automatic login in the persistent profile, against real Chromium and a local fixture site with one login shape per path.
// Linux only, like the profile check: that is where Chromium keeps cookies in a form the service reads.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGuard } from "../src/guard.js";
import { startGuardProxy, type GuardProxy } from "../src/proxy.js";
import { createProfileChecker } from "../src/profile-check.js";
import type { LoginRequest } from "../src/login.js";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 60_000 });
const linux = process.platform === "linux";

const USER = "buyer@example.test";
const PASSWORD = "correct horse";
const LONG_PASSWORD = `p"'😀${"x".repeat(190)}`;
const ACCOUNT = "C-10442";
const FILLER = "Welcome back. ".repeat(30); // enough text for the classifier to call a page real

const posts: Record<string, URLSearchParams[]> = {};
const events: Record<string, number> = {};
const count = (name: string) => (events[name] = (events[name] ?? 0) + 1);

const page = (body: string, title = "Supplier") =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;
const form = (action: string, inner: string, extra = "") =>
  `<form method="post" action="${action}" ${extra}>${inner}<button type="submit">Sign in</button></form>`;
const userAndPassword = '<label>Email <input type="email" name="username"></label><label>Password <input type="password" name="password"></label>';
const good = (b: URLSearchParams) => b.get("username") === USER && [PASSWORD, LONG_PASSWORD].includes(b.get("password") ?? "");

/** What a correct password leads to, per case. `null` = log in and go to the account page. */
const AFTER: Record<string, string | null> = {
  one: null,
  frame: null,
  banner: null,
  modal: null,
  modalx: null,
  check: null,
  push: page("<p>We sent a notification. Approve the sign-in on your phone.</p>"),
  locked: page("<p>Your account is locked. Call us.</p>"),
  question: page('<label>Your first school <input type="text" name="answer" oninput="fetch(\'/question/typed\')"></label><button>Go</button>'),
  puzzle: page('<div class="g-recaptcha" style="width:300px;height:80px;background:#eee"></div>'),
  code: page('<label>Code <input autocomplete="one-time-code" name="c"></label>'),
  stay: page('<h1>Stay signed in?</h1><form method="post" action="/stay/yes"><button type="submit">Yes</button></form>'),
};

const loggedIn = (req: IncomingMessage) => /(?:^|; )sid=ok(?:;|$)/.test(req.headers.cookie ?? "");
const loginCookie = { "set-cookie": "sid=ok; Path=/; HttpOnly", location: "/account" };

async function body(req: IncomingMessage) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return new URLSearchParams(raw);
}

function startSite(): Promise<Server> {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const html = (s: string, status = 200) => res.writeHead(status, { "content-type": "text/html; charset=utf-8" }).end(s);
    const [, kase = "", step = ""] = url.pathname.split("/");
    if (req.method === "POST") {
      const b = await body(req);
      (posts[kase] ??= []).push(b);
      if (kase === "two" && step === "user") return html(page(form("/two/pass", `<input type="hidden" name="username" value="${b.get("username")}"><input type="password" name="password">`)));
      if (kase === "two" && step === "pass") return good(b) ? res.writeHead(302, loginCookie).end() : html(page("no"));
      if (kase === "choice" && step === "user")
        return html(page(`<button type="button" onclick="document.getElementById('f').style.display='block';this.remove()">Use password</button><button type="button">Send me a code</button>
          <div id="f" style="display:none">${form("/choice/pass", `<input type="hidden" name="username" value="${b.get("username")}"><input type="password" name="password">`)}</div>`));
      if (kase === "choice" && step === "pass") return good(b) ? res.writeHead(302, loginCookie).end() : html(page("no"));
      if (kase === "acct") return b.get("customer") === ACCOUNT && good(b) ? res.writeHead(302, loginCookie).end() : html(page(form("/acct/login", acctForm) + "<p>Wrong details</p>"));
      if (kase === "loop") return html(page(form("/loop/login", '<input type="text" name="username">')));
      if (kase === "stay" && step === "yes") return res.writeHead(302, loginCookie).end();
      if (kase === "storage") return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ token: "tok-123" }));
      if (!good(b)) return html(page(form(`/${kase}/login`, userAndPassword) + "<p>Wrong password, try again.</p>"));
      const after = AFTER[kase];
      if (after === null) return res.writeHead(302, loginCookie).end();
      if (kase === "question") return res.writeHead(302, { location: "/question/ask" }).end(); // its own page, not the login address
      return html(after ?? page("?"));
    }
    if (url.pathname === "/account") return loggedIn(req) ? html(page(`<h1>Your account</h1><p>${FILLER}</p>`, "Account")) : res.writeHead(302, { location: "/one/login" }).end();
    if (step === "typed" || step === "accepted") {
      count(`${kase}/${step}`);
      return res.writeHead(204).end();
    }
    if (kase === "question" && step === "ask") return html(AFTER.question!);
    if (step !== "login" && step !== "inner" && step !== "form" && step !== "app") return html(page("not here"), 404);
    if (kase === "one" && loggedIn(req)) return res.writeHead(302, { location: "/account" }).end();
    switch (kase) {
      case "one": case "push": case "locked": case "question": case "puzzle": case "code": case "stay":
        return html(page(form(`/${kase}/login`, userAndPassword)));
      case "two": return html(page(form("/two/user", '<input type="email" name="username"><button type="submit">Next</button>').replace('<button type="submit">Sign in</button>', "")));
      case "choice": return html(page(form("/choice/user", '<input type="email" name="username">')));
      case "modal":
        return html(page(`<p>Trade supplies.</p><button type="button" onclick="document.getElementById('m').style.display='block'">Sign in</button><div id="m" style="display:none">${form("/modal/login", userAndPassword)}</div>`));
      case "modalx":
        return html(page(`<p>Trade supplies.</p><button id="acct" type="button" style="width:30px;height:30px" onclick="document.getElementById('m').style.display='block'"><svg width="20" height="20"></svg></button><div id="m" style="display:none"><form method="post" action="/modalx/login">${userAndPassword}<input type="submit" value="Go"></form></div>`));
      case "frame":
        return step === "inner" ? html(page(form("/frame/login", userAndPassword, 'target="_top"'))) : html(page('<p>Log in below</p><iframe src="/frame/inner" width="600" height="400"></iframe>'));
      case "banner":
        return html(page(`${form("/banner/login", userAndPassword)}<div id="b" style="position:fixed;inset:0;background:rgba(0,0,0,.5)"><p>We use cookies</p><button type="button" onclick="fetch('/banner/accepted');document.getElementById('b').remove()">Accept all</button></div>`));
      case "acct": return html(page(form("/acct/login", acctForm)));
      case "check":
        return step === "form" ? html(page(form("/check/login", userAndPassword))) : html(page("<p>Checking your browser before accessing the site.</p><script>setTimeout(()=>location.href='/check/form',3000)</script>", "Just a moment..."));
      case "loop": return html(page(form("/loop/login", '<input type="text" name="username">')));
      case "storage":
        return step === "app"
          ? html(page(`<script>if(!localStorage.getItem('token'))location.replace('/storage/login')</script><h1>Orders</h1><p>${FILLER}</p>`, "Orders"))
          : html(page(`<form id="f">${userAndPassword}<button type="submit">Sign in</button></form><script>document.getElementById('f').onsubmit=async(e)=>{e.preventDefault();const r=await fetch('/storage/api',{method:'POST',body:new URLSearchParams(new FormData(e.target))});localStorage.setItem('token',(await r.json()).token);location.href='/storage/app'}</script>`));
      case "wrong": return html(page(form("/wrong/login", userAndPassword)));
    }
    return html(page("not here"), 404);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}
const acctForm = '<label>Customer number <input type="text" name="customer"></label>' + userAndPassword;

let site: Server;
let base = "";
let proxy: GuardProxy;
const dirs: string[] = [];

beforeAll(async () => {
  if (!linux) return;
  site = await startSite();
  const { port } = site.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
  proxy = await startGuardProxy(createGuard({ allowHosts: [`127.0.0.1:${port}`] }));
});
afterAll(async () => {
  await proxy?.close();
  await new Promise((r) => (site ? site.close(r) : r(null)));
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** A new checker with its own, empty profile folder, so cases do not share a login. */
const checker = (log?: (line: string) => void) => {
  const dir = mkdtempSync(join(tmpdir(), "sm-test-login-"));
  dirs.push(dir);
  return createProfileChecker({ proxy, sandbox: !process.env.CI, headless: !process.env.DISPLAY, baseDir: dir, settleMs: 3000, loginStepMs: 5000, log });
};
const ask = (kase: string, extra: Partial<LoginRequest> = {}): LoginRequest => ({
  loginUrl: `${base}/${kase}/login`, checkUrl: `${base}/account`, username: USER, password: PASSWORD, stealth: false, ...extra,
});
const cookieNames = (o: { state?: { cookies: { name?: unknown }[] } }) => o.state?.cookies.map((c) => c.name) ?? [];

describe.skipIf(!linux)("automatic login in the persistent profile", () => {
  it("logs in on a one-step form", async () => {
    const out = await checker().login(ask("one"));
    expect(out.result).toBe("ok");
    expect(cookieNames(out as never)).toContain("sid");
  });
  it("two-step login", async () => {
    expect((await checker().login(ask("two"))).result).toBe("ok");
  });
  it("choice screen", async () => {
    expect((await checker().login(ask("choice"))).result).toBe("ok");
  });
  it("modal by auto rule", async () => {
    expect((await checker().login(ask("modal"))).result).toBe("ok");
  });
  it("modal by override", async () => {
    expect((await checker().login(ask("modalx", { selectors: { open: "#acct" } }))).result).toBe("ok");
  });
  it("form in iframe", async () => {
    expect((await checker().login(ask("frame"))).result).toBe("ok");
  });
  it("cookie banner", async () => {
    expect((await checker().login(ask("banner"))).result).toBe("ok");
    expect(events["banner/accepted"]).toBe(1);
  });
  it("stay signed in", async () => {
    expect((await checker().login(ask("stay"))).result).toBe("ok");
  });
  it("account number", async () => {
    posts.acct = [];
    expect((await checker().login(ask("acct", { account: ACCOUNT }))).result).toBe("ok");
    const sent = posts.acct.at(-1)!;
    expect([sent.get("customer"), sent.get("username"), sent.get("password")]).toEqual([ACCOUNT, USER, PASSWORD]);
  });
  it("account box, none saved", async () => {
    expect((await checker().login(ask("acct"))).result).toBe("form_not_found");
  });
  it("browser check page", async () => {
    expect((await checker().login(ask("check"))).result).toBe("ok");
  });
  it("push approval", async () => {
    expect((await checker().login(ask("push"))).result).toBe("code_required");
  });
  it("account locked", async () => {
    expect((await checker().login(ask("locked"))).result).toBe("account_locked");
  });
  it("token in page storage", async () => {
    const out = await checker().login(ask("storage", { checkUrl: `${base}/storage/app` }));
    expect(out.result).toBe("ok");
    expect(JSON.stringify(out.state?.origins)).toContain("tok-123");
  });
  it("no username after password", async () => {
    expect((await checker().login(ask("question"))).result).toBe("unknown");
    expect(events["question/typed"] ?? 0).toBe(0);
  });
  it("loop limit", async () => {
    posts.loop = [];
    expect((await checker().login(ask("loop"))).result).toBe("form_not_found");
    expect(posts.loop.length).toBeLessThanOrEqual(5);
  });
  it("already logged in", async () => {
    const c = checker();
    posts.one = [];
    expect((await c.login(ask("one"))).result).toBe("ok");
    const second = await c.login(ask("one"));
    expect(second.result).toBe("ok");
    expect(posts.one.length).toBe(1);
  });
  it("wrong password", async () => {
    expect((await checker().login(ask("wrong", { password: "nope" }))).result).toBe("wrong_password");
  });
  it("puzzle", async () => {
    const out = await checker().login(ask("puzzle"));
    expect(out.result).toBe("captcha");
    expect(out).not.toHaveProperty("state");
  });
  it("code", async () => {
    expect((await checker().login(ask("code"))).result).toBe("code_required");
  });
  it("selector override not found", async () => {
    expect((await checker().login(ask("one", { selectors: { username: "#nope" } }))).result).toBe("form_not_found");
  });
  it("exact typing", async () => {
    posts.one = [];
    expect((await checker().login(ask("one", { password: LONG_PASSWORD }))).result).toBe("ok");
    expect(Buffer.from(posts.one.at(-1)!.get("password")!, "utf8").equals(Buffer.from(LONG_PASSWORD, "utf8"))).toBe(true);
  });
  it("password never logged", async () => {
    const lines: string[] = [];
    const c = checker((line) => lines.push(line));
    await c.login(ask("wrong", { password: "nope-secret" }));
    await c.login(ask("one"));
    expect(lines.length).toBeGreaterThan(0);
    const all = lines.join("\n");
    for (const secret of [USER, PASSWORD, "nope-secret"]) expect(all).not.toContain(secret);
  });
});
