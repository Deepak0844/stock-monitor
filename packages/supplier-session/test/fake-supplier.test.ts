import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { classifyPage } from "../src/classify.js";
import { createFakeSupplier, FAKE_PASSWORD, FAKE_USERNAME, type FakeSupplier } from "./fake-supplier.js";

let site: FakeSupplier;
beforeAll(async () => {
  site = await createFakeSupplier();
});
afterAll(async () => {
  await site.close();
});
beforeEach(() => {
  site.expireSessions();
  site.requests.length = 0;
});

const get = (path: string, cookie?: string) =>
  fetch(site.url + path, { redirect: "manual", headers: cookie ? { cookie } : {} });
const login = async (user = FAKE_USERNAME, password = FAKE_PASSWORD) =>
  fetch(site.url + "/login", {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: user, password }),
  });
const sessionCookie = (res: Response) => res.headers.get("set-cookie")?.split(";")[0] ?? "";
const loggedIn = async () => sessionCookie(await login());
const textOf = (html: string) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("login and the account page", () => {
  it("shows a login form with a password field", async () => {
    const res = await get("/login");
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(body).toContain('type="password"');
    expect(body).toContain('name="username"');
  });

  it("sets an HttpOnly session cookie for the right details and sends the visitor on to the account", async () => {
    const res = await login();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/account");
    expect(res.headers.get("set-cookie")).toMatch(/^supplier_session=[0-9a-f]+;.*HttpOnly/i);
  });

  it("refuses wrong details with a 401 and no cookie", async () => {
    for (const [u, p] of [[FAKE_USERNAME, "wrong"], ["nobody", FAKE_PASSWORD], ["", ""]] as const) {
      const res = await login(u, p);
      expect(res.status).toBe(401);
      expect(res.headers.get("set-cookie")).toBeNull();
      expect(await res.text()).toContain("Wrong details");
    }
  });

  it("only follows a next address on this site", async () => {
    const send = (next: string) =>
      fetch(site.url + "/login", {
        method: "POST",
        redirect: "manual",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ username: FAKE_USERNAME, password: FAKE_PASSWORD, next }),
      });
    expect((await send("/products/blue-widget")).headers.get("location")).toBe("/products/blue-widget");
    for (const evil of ["https://evil.example/", "//evil.example/", "http://169.254.169.254/"]) {
      expect((await send(evil)).headers.get("location"), evil).toBe("/account");
    }
  });

  it("loads the account page with the cookie", async () => {
    const res = await get("/account", await loggedIn());
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Your account");
  });

  it("sends a visitor with no cookie, or a made-up one, to the login form", async () => {
    for (const cookie of [undefined, "supplier_session=forged"]) {
      const res = await get("/account", cookie);
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/login?next=%2Faccount");
    }
  });
});

describe("expiring sessions", () => {
  it("sends every logged-in visitor back to the login form", async () => {
    const a = await loggedIn();
    const b = await loggedIn();
    expect((await get("/account", a)).status).toBe(200);
    site.expireSessions();
    expect((await get("/account", a)).status).toBe(302);
    expect((await get("/account", b)).status).toBe(302);
  });

  it("can be switched from outside, so a test in another container can do it", async () => {
    const cookie = await loggedIn();
    expect((await fetch(site.url + "/__expire", { method: "POST" })).status).toBe(204);
    expect((await get("/account", cookie)).status).toBe(302);
  });

  it("lets a fresh login work after an expiry", async () => {
    site.expireSessions();
    expect((await get("/account", await loggedIn())).status).toBe(200);
  });
});

describe("product pages", () => {
  it("shows the product to anyone but hides the price until logged in", async () => {
    const anon = await (await get("/products/blue-widget")).text();
    expect(anon).toContain("Blue Widget");
    expect(anon).not.toContain("£48.00");
    expect(textOf(anon).toLowerCase()).toContain("log in to see prices");
    const member = await (await get("/products/blue-widget", await loggedIn())).text();
    expect(member).toContain("£48.00");
    expect(member).not.toMatch(/log in to see prices/i);
  });

  it("gives a 404 for a product that does not exist", async () => {
    expect((await get("/products/nothing-here")).status).toBe(404);
  });
});

describe("pages that need attention", () => {
  it("has a challenge page with a widget marker and the wording the classifier looks for", async () => {
    for (const [widget, marker] of [["recaptcha", "g-recaptcha"], ["hcaptcha", "h-captcha"], ["turnstile", "cf-turnstile"]]) {
      const res = await get(`/captcha?widget=${widget}`);
      const body = await res.text();
      expect(body, widget).toContain(`class="${marker}"`);
      expect(body.toLowerCase(), widget).toContain("verify you are human");
    }
  });

  it("is read as a captcha, a block and a normal page by the classifier", async () => {
    const asFacts = async (path: string, cookie?: string) => {
      const res = await get(path, cookie);
      return classifyPage({
        requestedUrl: site.url + path,
        page: { finalUrl: site.url + path, status: res.status, title: "", text: textOf(await res.text()), hasPasswordField: false, hasChallengeWidget: false },
      });
    };
    expect(await asFacts("/captcha")).toBe("captcha");
    expect(await asFacts("/blocked")).toBe("blocked");
    expect(await asFacts("/rate-limited")).toBe("blocked");
    expect(await asFacts("/account", await loggedIn())).toBe("ok");
    expect(await asFacts("/products/blue-widget", await loggedIn())).toBe("ok");
    expect(await asFacts("/products/blue-widget")).toBe("login_required");
  });

  it("answers 403 for the block page and 429 with Retry-After for the rate limit", async () => {
    const blocked = await get("/blocked");
    expect(blocked.status).toBe(403);
    expect(await blocked.text()).toMatch(/access denied/i);
    const limited = await get("/rate-limited");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
  });

  it("holds a slow page for the time asked", async () => {
    const t0 = Date.now();
    expect((await get("/slow?ms=300")).status).toBe(200);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(280);
  });
});

describe("addresses that point at private networks", () => {
  it.each([
    ["/redirect/metadata", "http://169.254.169.254/latest/meta-data/"],
    ["/redirect/loopback", "http://127.0.0.1:8099/"],
    ["/redirect/private", "http://10.0.0.5/admin"],
  ])("%s redirects to %s", async (path, target) => {
    const res = await get(path);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(target);
  });

  it("redirects wherever it is told, for tests that need a real listener to prove it was not reached", async () => {
    const res = await get(`/redirect-to?url=${encodeURIComponent("http://127.0.0.1:9/hit")}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("http://127.0.0.1:9/hit");
  });

  it("has a page that tries to load an image and open a WebSocket on a private address", async () => {
    const body = await (await get("/embeds-private")).text();
    expect(body).toContain('src="http://10.0.0.5/pixel.png"');
    expect(body).toContain('new WebSocket("ws://10.0.0.5/socket")');
  });

  it("has a page that links to a private address", async () => {
    expect(await (await get("/links-private")).text()).toContain('href="http://10.0.0.5/"');
  });
});

describe("the server", () => {
  it("records each request, so a test can prove something was or was not asked for", async () => {
    await get("/login");
    await get("/products/blue-widget");
    expect(site.requests.map((r) => `${r.method} ${r.path}`)).toEqual(["GET /login", "GET /products/blue-widget"]);
  });

  it("answers 404 for an unknown address", async () => {
    expect((await get("/nope")).status).toBe(404);
  });

  it("starts on a free port each time, and stops cleanly even with a slow request open", async () => {
    const a = await createFakeSupplier();
    const b = await createFakeSupplier();
    expect(a.port).not.toBe(b.port);
    expect((await fetch(a.url + "/login")).status).toBe(200);
    const pending = fetch(a.url + "/slow?ms=30000").catch(() => "closed");
    await new Promise((r) => setTimeout(r, 50));
    const t0 = Date.now();
    await a.close();
    await b.close();
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(await pending).toBe("closed");
    await expect(fetch(a.url + "/login")).rejects.toThrow();
  });
});
