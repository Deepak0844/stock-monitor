// Automatic login in the persistent profile, against real Chromium and a local fixture site with one login shape per path.
// Linux only, like the profile check: that is where Chromium keeps cookies in a form the service reads.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGuard } from "../src/guard.js";
import { startGuardProxy, type GuardProxy } from "../src/proxy.js";
import { createProfileChecker } from "../src/profile-check.js";
import { profileDirFor } from "../src/profile-store.js";
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
  slow: null,
  slower: null,
  lazy: null,
  recap: null,
  hash: null,
  token: null,
  frame: null,
  banner: null,
  modal: null,
  modalx: null,
  check: null,
  postcode: null,
  push: page("<p>We sent a notification. Approve the sign-in on your phone.</p>"),
  locked: page("<p>Your account is locked. Call us.</p>"),
  // Rendered at the login address, as many sites do: still not a wrong password.
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

// TEMPORARY (remove once the CI cause is known): what the first test's page and fixture saw. Lengths only, never values.
const diag = { on: false, seen: [] as string[], report: "" };
const DIAG_SCRIPT = `<script>
const t0=performance.now(),first={},count={},at=(n)=>n+"@"+Math.round(performance.now()-t0)+"ms focus="+document.hasFocus()+" vis="+document.visibilityState;
for(const n of["focusin","keydown","input","pointerdown","mousedown","click","submit"])addEventListener(n,(e)=>{count[n]=(count[n]||0)+1;first[n]??=at(n)+" on "+(e.target.name||e.target.tagName)},true);
const send=()=>navigator.sendBeacon("/diag/report",JSON.stringify({usernameLength:document.querySelector("[name=username]").value.length,passwordLength:document.querySelector("[name=password]").value.length,count,first,now:at("report")}));
setTimeout(send,8000);addEventListener("pagehide",send);
</script>`;

function startSite(): Promise<Server> {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    if (diag.on) diag.seen.push(`${req.method} ${url.pathname}`);
    if (url.pathname === "/diag/report") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      diag.report = raw;
      return res.writeHead(204).end();
    }
    const html = (s: string, status = 200) => res.writeHead(status, { "content-type": "text/html; charset=utf-8" }).end(s);
    const [, kase = "", step = ""] = url.pathname.split("/");
    if (req.method === "POST") {
      const b = await body(req);
      (posts[kase] ??= []).push(b);
      // A supplier that takes 4.5 s to answer any password, longer than a click waits.
      if (kase === "slower") await new Promise((r) => setTimeout(r, 4500));
      if (kase === "token") await new Promise((r) => setTimeout(r, 3000));
      // The captcha and hashing logins' server takes 2 s, so a second send would land before the first answer.
      if (kase === "recap" || kase === "hash") await new Promise((r) => setTimeout(r, 2000));
      if (kase === "beacon" && step === "collect") return res.writeHead(204).end();
      // A WebForms-style server: a POST without the button's name and value is not a login.
      if (kase === "webforms") return good(b) && b.get("btnLogin") === "Log in" ? res.writeHead(302, loginCookie).end() : html(page(webForm));
      if (kase === "two" && step === "user") return html(page(form("/two/pass", `<input type="hidden" name="username" value="${b.get("username")}"><input type="password" name="password">`)));
      // A slow username step: answered after 3.5 s, while its tracking frame loads.
      if (kase === "slowtwo" && step === "user") {
        await new Promise((r) => setTimeout(r, 3500));
        return html(page(form("/slowtwo/pass", `<input type="hidden" name="username" value="${b.get("username")}"><input type="password" name="password">`)));
      }
      if (kase === "slowtwo" && step === "pass") return good(b) ? res.writeHead(302, loginCookie).end() : html(page("no"));
      if (kase === "two" && step === "pass") return good(b) ? res.writeHead(302, loginCookie).end() : html(page("no"));
      if (kase === "choice" && step === "user")
        return html(page(`<button type="button" onclick="document.getElementById('f').style.display='block';this.remove()">Use password</button><button type="button">Send me a code</button>
          <div id="f" style="display:none">${form("/choice/pass", `<input type="hidden" name="username" value="${b.get("username")}"><input type="password" name="password">`)}</div>`));
      if (kase === "choice" && step === "pass") return good(b) ? res.writeHead(302, loginCookie).end() : html(page("no"));
      if (kase === "acct") return b.get("customer") === ACCOUNT && good(b) ? res.writeHead(302, loginCookie).end() : html(page(form("/acct/login", acctForm) + "<p>Wrong details</p>"));
      if (kase === "loop") return html(page(form("/loop/login", '<input type="text" name="username">')));
      if (kase === "stay" && step === "yes") return res.writeHead(302, loginCookie).end();
      if (kase === "storage") return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ token: "tok-123" }));
      // A shop whose product page is public: any password lands on it, and only a real login shows "Log out".
      if (kase === "public") return res.writeHead(302, good(b) ? { ...loginCookie, location: "/public/product" } : { location: "/public/product" }).end();
      if (!good(b)) return html(page(form(`/${kase}/login`, userAndPassword) + "<p>Wrong password, try again.</p>"));
      if (kase === "busy") return html(page("<p>Too many requests.</p>"), 429);
      // A slow supplier: the right password, answered only after 2.5 s.
      if (kase === "slow") await new Promise((r) => setTimeout(r, 2500));
      if (kase === "promo") return res.writeHead(302, { ...loginCookie, location: "/promo/home" }).end();
      const after = AFTER[kase];
      if (after === null) return res.writeHead(302, loginCookie).end();
      return html(after ?? page("?"));
    }
    if (url.pathname === "/account") return loggedIn(req) ? html(page(`<h1>Your account</h1><p>${FILLER}</p>`, "Account")) : res.writeHead(302, { location: "/one/login" }).end();
    if (step === "typed" || step === "accepted") {
      count(`${kase}/${step}`);
      return res.writeHead(204).end();
    }
    // A logged-in page that has a promo code box is still a login.
    if (kase === "promo" && step === "home") return html(page(`<h1>Your account</h1><p>${FILLER}</p><label>Promo code <input type="text" name="promo_code"></label>`, "Account"));
    if (kase === "public" && step === "product") return html(page(`<h1>Blue widget</h1><p>${FILLER}</p>${loggedIn(req) ? '<a href="/logout">Log  out</a>' : ""}`, "Blue widget"));
    if (step === "track") return html(page("tracked"));
    if (step !== "login" && step !== "inner" && step !== "form" && step !== "app") return html(page("not here"), 404);
    if (kase === "one" && loggedIn(req)) return res.writeHead(302, { location: "/account" }).end();
    switch (kase) {
      case "slow":
        return html(page(form("/slow/login", userAndPassword, `onsubmit="event.preventDefault();document.getElementById('t').src='/slow/track';setTimeout(()=>this.submit(),200)"`) + '<iframe id="t" width="1" height="1"></iframe>'));
      case "one": if (diag.on) return html(page(form("/one/login", userAndPassword) + DIAG_SCRIPT));
      // falls through
      case "slower": case "push": case "locked": case "question": case "puzzle": case "code": case "stay": case "promo": case "busy": case "public":
        return html(page(form(`/${kase}/login`, userAndPassword)));
      case "two": return html(page(form("/two/user", '<input type="email" name="username"><button type="submit">Next</button>').replace('<button type="submit">Sign in</button>', "")));
      // A first click that never reaches the submit button, as on a window that has just opened: a cover appears under
      // the pointer between press and release, so the click lands on the page, not the button.
      case "lazy":
        return html(page(`<form method="post" action="/lazy/login">${userAndPassword}<button type="submit" onmousedown="if(!window.armed){window.armed=1;const c=document.createElement('div');c.style.cssText='position:fixed;inset:0;z-index:9';document.body.append(c);setTimeout(()=>c.remove(),500)}">Sign in</button></form>`));
      // Invisible-captcha style: the click handler stops the submit, a captcha frame loads, the form is sent 3 s later.
      case "recap":
        return html(page(`<form method="post" action="/recap/login">${userAndPassword}<button type="submit" onclick="event.preventDefault();const f=this.form;document.getElementById('c').src='/recap/frame';setTimeout(()=>f.submit(),3000)">Sign in</button></form><iframe id="c" width="1" height="1"></iframe>`));
      // Slow hashing in the page: no request at all for 3 s, then the form is sent.
      case "hash":
        return html(page(`<form method="post" action="/hash/login">${userAndPassword}<button type="submit" onclick="event.preventDefault();const f=this.form;setTimeout(()=>f.submit(),3000)">Sign in</button></form>`));
      // The login posts to another site only: not the supplier's answer.
      case "elsewhere":
        return html(page(form("/elsewhere/login", userAndPassword, `onsubmit="event.preventDefault();fetch(location.href.replace('127.0.0.1','localhost'),{method:'POST',body:new URLSearchParams(new FormData(this))})"`)));
      // A script login that fetches a token, works for 3 s, then posts to a server that takes 3 s to answer.
      case "token":
        return html(page(form("/token/login", userAndPassword, `onsubmit="event.preventDefault();const body=new URLSearchParams(new FormData(this));fetch('/token/csrf').then(()=>setTimeout(()=>fetch('/token/login',{method:'POST',body}).then(()=>location.href='/account'),3000))"`)));
      // An analytics beacon on the click, and a submit that never goes.
      case "beacon":
        return html(page(`<form method="post" action="/beacon/login">${userAndPassword}<button type="submit" onclick="navigator.sendBeacon('/beacon/collect','x');event.preventDefault()">Sign in</button></form>`));
      case "webforms": return html(page(webForm));
      // A form that never sends anything.
      case "dead": return html(page(form("/dead/login", userAndPassword, 'onsubmit="event.preventDefault()"')));
      case "slowtwo":
        return html(page(form("/slowtwo/user", '<input type="email" name="username"><button type="submit">Next</button>', `onsubmit="event.preventDefault();document.getElementById('t').src='/slowtwo/track';setTimeout(()=>this.submit(),200)"`).replace('<button type="submit">Sign in</button>', "") + '<iframe id="t" width="1" height="1"></iframe>'));
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
      // A store finder's postcode box and a voucher box next to the login form.
      case "postcode":
        return html(page(`<label>Postcode <input type="text" name="postcode" id="postcode-search" placeholder="Enter postcode"></label>${form("/postcode/login", userAndPassword)}<label>Voucher code <input type="text" name="voucher"></label>`));
    }
    return html(page("not here"), 404);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}
const webForm = `<form method="post" action="/webforms/login">${userAndPassword}<input type="submit" name="btnLogin" value="Log in" onmousedown="if(!window.armed){window.armed=1;const c=document.createElement('div');c.style.cssText='position:fixed;inset:0;z-index:9';document.body.append(c);setTimeout(()=>c.remove(),500)}"></form>`;
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
  proxy = await startGuardProxy(createGuard({ allowHosts: [`127.0.0.1:${port}`, `localhost:${port}`] }));
});
afterAll(async () => {
  await proxy?.close();
  await new Promise((r) => (site ? site.close(r) : r(null)));
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** A new checker with its own, empty profile folder, so cases do not share a login. */
const checker = (log?: (line: string) => void, settleMs = 3000) => {
  const dir = mkdtempSync(join(tmpdir(), "sm-test-login-"));
  dirs.push(dir);
  return Object.assign(createProfileChecker({ proxy, sandbox: !process.env.CI, headless: !process.env.DISPLAY, baseDir: dir, settleMs, loginStepMs: 5000, log }), { dir });
};
const ask = (kase: string, extra: Partial<LoginRequest> = {}): LoginRequest => ({
  loginUrl: `${base}/${kase}/login`, checkUrl: `${base}/account`, username: USER, password: PASSWORD, stealth: false, ...extra,
});
const cookieNames = (o: { state?: { cookies: { name?: unknown }[] } }) => o.state?.cookies.map((c) => c.name) ?? [];

describe.skipIf(!linux)("automatic login in the persistent profile", () => {
  it("logs in on a one-step form", async () => {
    diag.on = true;
    diag.seen = [];
    diag.report = "";
    const out = await checker().login(ask("one"));
    diag.on = false;
    if (out.result !== "ok") console.log("DIAG one-step", JSON.stringify({ result: out.result, requests: diag.seen, page: diag.report ? JSON.parse(diag.report) : "no report reached the fixture" }, null, 1));
    expect(out.result).toBe("ok");
    expect(cookieNames(out as never)).toContain("sid");
  });
  it("waits for a slow supplier's answer before it reads the page: a right password is never called wrong", async () => {
    expect((await checker().login(ask("slow"))).result).toBe("ok");
  });
  it("a supplier slower than a click: the right password is ok", async () => {
    posts.slower = [];
    expect((await checker(undefined, 8000).login(ask("slower"))).result).toBe("ok");
    expect(posts.slower.length).toBe(1);
  });
  it("a supplier slower than a click: a wrong password is wrong, sent once", async () => {
    posts.slower = [];
    expect((await checker(undefined, 8000).login(ask("slower", { password: "nope" }))).result).toBe("wrong_password");
    expect(posts.slower.length).toBe(1);
  });
  it("two-step login", async () => {
    expect((await checker().login(ask("two"))).result).toBe("ok");
  });
  it("a slow username step: Next is clicked once, and no empty password is ever sent", async () => {
    posts.slowtwo = [];
    expect((await checker().login(ask("slowtwo"))).result).toBe("ok");
    expect(posts.slowtwo.filter((b) => !b.has("password")).length).toBe(1);
    expect(posts.slowtwo.filter((b) => b.get("password") === "").length).toBe(0);
    expect(posts.slowtwo.filter((b) => b.get("password") === PASSWORD).length).toBe(1);
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
  it("a public product page: without a logged-in marker a wrong password looks like a login", async () => {
    expect((await checker().login(ask("public", { password: "nope", checkUrl: `${base}/public/product` }))).result).toBe("ok");
  });
  it("a public product page: the logged-in marker catches a wrong password", async () => {
    expect((await checker().login(ask("public", { password: "nope", checkUrl: `${base}/public/product`, loggedInMarker: "Log out" }))).result).not.toBe("ok");
  });
  it("a public product page: the logged-in marker confirms a real login", async () => {
    expect((await checker().login(ask("public", { checkUrl: `${base}/public/product`, loggedInMarker: "log out" }))).result).toBe("ok");
  });
  it("wrong password", async () => {
    posts.wrong = [];
    expect((await checker().login(ask("wrong", { password: "nope" }))).result).toBe("wrong_password");
    expect(posts.wrong.length).toBe(1);
  });
  it("a first click that never reaches the button: the form is sent once, another way", async () => {
    posts.lazy = [];
    expect((await checker().login(ask("lazy"))).result).toBe("ok");
    expect(posts.lazy.length).toBe(1);
  });
  it("an invisible captcha that sends the form itself 3 s later is not sent again", async () => {
    posts.recap = [];
    expect((await checker(undefined, 8000).login(ask("recap"))).result).toBe("ok");
    expect(posts.recap.length).toBe(1);
  });
  it("slow hashing in the page with no request is not sent again", async () => {
    posts.hash = [];
    expect((await checker(undefined, 8000).login(ask("hash"))).result).toBe("ok");
    expect(posts.hash.length).toBe(1);
  });
  it("a POST to another site only is not a sent login", async () => {
    expect((await checker().login(ask("elsewhere"))).result).toBe("unknown");
  });
  it("a login doing slow work before its POST is not sent again", async () => {
    posts.token = [];
    expect((await checker(undefined, 10_000).login(ask("token"))).result).toBe("ok");
    expect(posts.token.length).toBe(1);
  });
  it("an analytics beacon is not a sent login: a swallowed submit is unknown", async () => {
    posts.beacon = [];
    expect((await checker().login(ask("beacon"))).result).toBe("unknown");
    expect(posts.beacon.filter((b) => b.has("password")).length).toBe(0);
  });
  it("sent once more, a WebForms-style login keeps its button's name and value", async () => {
    posts.webforms = [];
    expect((await checker().login(ask("webforms"))).result).toBe("ok");
    expect(posts.webforms.length).toBe(1);
  });
  it("a submit that never sends anything is unknown, never a wrong password", async () => {
    posts.dead = [];
    expect((await checker().login(ask("dead"))).result).toBe("unknown");
    expect(posts.dead.length).toBe(0);
  });
  it("puzzle", async () => {
    const out = await checker().login(ask("puzzle"));
    expect(out.result).toBe("captcha");
    expect(out).not.toHaveProperty("state");
  });
  it("code", async () => {
    expect((await checker().login(ask("code"))).result).toBe("code_required");
  });
  it("a postcode box next to the login form is not a code box", async () => {
    posts.postcode = [];
    expect((await checker().login(ask("postcode"))).result).toBe("ok");
    expect(posts.postcode.at(-1)?.get("username")).toBe(USER);
  });
  it("a promo code box on the page after the login is still ok", async () => {
    expect((await checker().login(ask("promo"))).result).toBe("ok");
  });
  it("too many requests after the password is unreachable", async () => {
    expect((await checker().login(ask("busy"))).result).toBe("unreachable");
  });
  it("selector override not found", async () => {
    expect((await checker().login(ask("one", { selectors: { username: "#nope" } }))).result).toBe("form_not_found");
  });
  it("password override not found: nothing is submitted", async () => {
    posts.one = [];
    expect((await checker().login(ask("one", { selectors: { password: "#nope" } }))).result).toBe("form_not_found");
    expect(posts.one.length).toBe(0);
  });
  it("login on another host uses the profile of the site the checks visit", async () => {
    const c = checker();
    const request = ask("one", { loginUrl: base.replace("127.0.0.1", "localhost") + "/one/login" });
    await c.login(request);
    expect(existsSync(join(profileDirFor(c.dir, request.checkUrl), "Default", "Preferences"))).toBe(true);
    expect(existsSync(profileDirFor(c.dir, request.loginUrl))).toBe(false);
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
