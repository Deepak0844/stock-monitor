// A small fake supplier website for tests. It has a login form, a cookie session that can be made to
// expire, an account page and product pages that need the login, a challenge page, block pages,
// a slow page, and addresses that point at private networks. Nothing here talks to the internet.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";

export const FAKE_USERNAME = "buyer";
export const FAKE_PASSWORD = "correct-horse-battery";
const COOKIE = "supplier_session";
const MAX_SLOW_MS = 30_000;

export type FakeSupplier = {
  /** For example http://127.0.0.1:41234 */
  url: string;
  port: number;
  /** Every request received, in order, without the query string. */
  requests: { method: string; path: string }[];
  /** Makes every saved login stop working, as if the supplier had logged everyone out. */
  expireSessions(): void;
  close(): Promise<void>;
};

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body>${body}</body></html>`;

// Enough ordinary shop text that a healthy page looks like a real one, not an empty shell.
const ABOUT =
  "<p>Fake Supplier Ltd sells wholesale packs to trade customers. Orders placed before noon leave the warehouse the same day. " +
  "All prices are per case and exclude delivery. Stock levels are updated every hour and shown on each product page. " +
  "Contact the trade desk for pallet quantities and special orders.</p>";
const PRODUCTS: Record<string, { name: string; price: string; stock: number }> = {
  "blue-widget": { name: "Blue Widget 12 pack", price: "£48.00", stock: 120 },
  "red-gadget": { name: "Red Gadget 6 pack", price: "£31.50", stock: 0 },
};
const WIDGETS: Record<string, string> = {
  recaptcha: '<div class="g-recaptcha" data-sitekey="fake-site-key"></div>',
  hcaptcha: '<div class="h-captcha" data-sitekey="fake-site-key"></div>',
  turnstile: '<div class="cf-turnstile" data-sitekey="fake-site-key"></div>',
};
const PRIVATE_TARGETS: Record<string, string> = {
  metadata: "http://169.254.169.254/latest/meta-data/",
  loopback: "http://127.0.0.1:8099/",
  private: "http://10.0.0.5/admin",
};

// Only addresses on this site are followed after a login. Anything else goes to the account page.
const safeNext = (next: string | null) =>
  next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\")
    ? next
    : "/account";

async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 10_000) break;
  }
  return new URLSearchParams(body);
}

export async function createFakeSupplier(options: { host?: string } = {}): Promise<FakeSupplier> {
  const host = options.host ?? "127.0.0.1";
  const sessions = new Set<string>();
  const timers = new Set<NodeJS.Timeout>();
  const requests: FakeSupplier["requests"] = [];

  const loggedIn = (req: IncomingMessage) => {
    const id = new RegExp(`(?:^|;\\s*)${COOKIE}=([0-9a-f]+)`).exec(req.headers.cookie ?? "")?.[1];
    return id !== undefined && sessions.has(id);
  };

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://fake.invalid");
    const path = url.pathname;
    requests.push({ method: req.method ?? "GET", path });
    const send = (status: number, html: string, headers: Record<string, string | string[]> = {}) => {
      res.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers });
      res.end(html);
    };
    const redirect = (to: string, headers: Record<string, string> = {}) => {
      res.writeHead(302, { location: to, ...headers });
      res.end();
    };
    const loginForm = (status: number, message: string, next: string) =>
      send(
        status,
        page(
          "Log in | Fake Supplier",
          `<h1>Log in</h1>${message}<form method="post" action="/login"><input type="hidden" name="next" value="${escapeHtml(next)}">` +
            `<label>Username <input name="username"></label><label>Password <input name="password" type="password"></label>` +
            `<button type="submit">Log in</button></form>`,
        ),
      );

    if (path === "/" && req.method === "GET") {
      return send(
        200,
        page(
          "Fake Supplier",
          `<h1>Fake Supplier</h1>${ABOUT}<a href="/products/blue-widget">Blue Widget</a> <a href="/login">Log in</a>`,
        ),
      );
    }
    if (path === "/login" && req.method === "GET")
      return loginForm(200, "", url.searchParams.get("next") ?? "");
    if (path === "/login" && req.method === "POST") {
      const form = await readForm(req);
      const next = form.get("next");
      if (form.get("username") !== FAKE_USERNAME || form.get("password") !== FAKE_PASSWORD) {
        return loginForm(401, "<p>Wrong details.</p>", next ?? "");
      }
      const id = randomBytes(16).toString("hex");
      sessions.add(id);
      return redirect(safeNext(next), {
        "set-cookie": `${COOKIE}=${id}; HttpOnly; Path=/; SameSite=Lax`,
      });
    }
    if (path === "/__expire" && req.method === "POST") {
      sessions.clear();
      res.writeHead(204);
      return res.end();
    }
    // A real shop can ship a page with no <title> at all. Only the page's text can say what it is.
    if (path === "/untitled") {
      const detail = loggedIn(req) ? "<p>Signed in as buyer.</p>" : "<p>Log in to see prices and stock.</p>";
      return send(200, page("", `<h1>Fake Supplier</h1>${detail}${ABOUT}`));
    }
    if (path === "/product-with-hidden-guards") {
      // A real product page that carries a hidden sign-in popup and a form's invisible spam guard. Neither is a wall.
      const popup = '<div style="display:none"><input type="password" name="popup-password"></div>';
      const guard = '<div class="g-recaptcha" data-sitekey="fake-site-key" data-size="invisible" style="position:absolute;left:-10000px"></div>';
      return send(200, page("Blue Widget | Fake Supplier", `<h1>Blue Widget</h1><p>In stock.</p>${popup}${guard}${ABOUT}`));
    }
    if (path === "/untitled-challenge") {
      return send(200, page("", `<h1>One moment</h1><p>Please verify you are human to continue.</p>${WIDGETS.recaptcha}${ABOUT}`));
    }
    if (path === "/account") {
      if (!loggedIn(req)) return redirect(`/login?next=${encodeURIComponent("/account")}`);
      return send(
        200,
        page(
          "Your account | Fake Supplier",
          `<h1>Your account</h1><p>Signed in as buyer.</p>${ABOUT}<a href="/products/blue-widget">Blue Widget</a>`,
        ),
        // Like a real shop that extends a session on each visit: a fresh cookie comes back with the page.
        // It also clears a one-time cookie, as shops do with a "where to go after login" cookie.
        { "set-cookie": ["last_visit=FRESH-COOKIE; Path=/; Max-Age=86400; SameSite=Lax", "login_redirect=; Path=/; Max-Age=0"] },
      );
    }
    const product = /^\/products\/([a-z-]+)$/.exec(path)?.[1];
    if (product !== undefined) {
      const item = PRODUCTS[product];
      if (!item) return send(404, page("Not found", "<h1>Not found</h1><p>No such product.</p>"));
      const detail = loggedIn(req)
        ? `<p>Wholesale price ${item.price} per case. ${item.stock} in stock.</p>`
        : "<p>Log in to see prices and stock.</p>";
      return send(
        200,
        page(`${item.name} | Fake Supplier`, `<h1>${item.name}</h1>${detail}${ABOUT}`),
      );
    }
    // Link-check cases: a page that is gone in each of the ways a real shop does it.
    if (path === "/gone410") return send(410, page("410 Gone", "<h1>410 Gone</h1><p>This product was removed.</p>"));
    if (path === "/soft404") return send(200, page("Page not found | Fake Supplier", `<h1>Page not found</h1><p>Try our home page.</p>${ABOUT}`));
    if (path === "/redirect-home") return redirect("/");
    if (path === "/redirect-category") return redirect("/collections/widgets");
    if (path === "/collections/widgets") return send(200, page("Widgets | Fake Supplier", `<h1>Widgets</h1>${ABOUT}`));
    if (path === "/renamed") return send(200, page("Red Gadget | Fake Supplier", `<h1>Red Gadget</h1>${ABOUT}`));
    // Stock pages for the extraction tests: made-up shop pages that show stock in different ways.
    if (path.startsWith("/stock/")) {
      const BUY = '<button>Add to cart</button>';
      const NOT_BUY = '<button disabled>Add to cart</button>';
      const table = (rows: string[][]) =>
        `<h2>Click and collect availability</h2><table>${rows.map(([name, n]) => `<tr><td>${name}</td><td>${n}</td></tr>`).join("")}</table>`;
      const variants: Record<string, string> = {
        in: `<h1>Blue Tee</h1><p>Soft cotton.</p>${BUY}`,
        "sold-out": `<h1>Blue Tee</h1><p>Soft cotton.</p><p>Sold out</p>${NOT_BUY}`,
        region: `<h1>Blue Tee</h1><p>Soft cotton.</p>${table([["Loughborough", "46"], ["Sheffield", "22"], ["Cardiff", "0"]])}`,
        "region-no-row": `<h1>Blue Tee</h1>${table([["Sheffield", "22"], ["Bristol", "48"]])}`,
        changed: `<h1>Blue Tee</h1><p>Soft cotton.</p><p>Currently unavailable</p><a href="/x">Tell me when it is back</a>`,
        "related-sold-out": `<h1>Blue Tee</h1>${BUY}<h2>You may also like</h2><p>Red Tee</p><p>Sold out</p>`,
        form:
          `<h1>Blue Tee</h1><form><input type="password" value="TYPED-SECRET-VALUE"><input type="hidden" name="t" value="HIDDEN-MARKER">` +
          `<textarea>TEXTAREA-SECRET</textarea><select><option>SELECT-SECRET</option></select><button type="submit">Save</button></form>` +
          `<script>window.x = "SCRIPT-MARKER"</script><style>.a{content:"STYLE-MARKER"}</style><div hidden>HIDDEN-TEXT</div><div style="display:none">DISPLAY-NONE-TEXT</div><noscript>NOSCRIPT-TEXT</noscript><p>Visible text</p>`,
        huge: `<h1>Blue Tee</h1><p>${"x".repeat(1_000_000)}</p>${Array.from({ length: 10_000 }, (_, n) => `<button>Button ${n}</button>`).join("")}${Array.from({ length: 8_000 }, (_, n) => `<p>Line ${n}</p>`).join("")}`,
      };
      // Ordinary shop text under the heading, so a healthy page does not look like an empty shell to the classifier.
      const html = variants[path.slice("/stock/".length)]?.replace("<h1>Blue Tee</h1>", `<h1>Blue Tee</h1>${ABOUT}`);
      if (html) return send(200, page("Blue Tee | Fake Supplier", html), { "set-cookie": "tracker=COOKIE-MARKER; Path=/" });
    }
    if (path === "/captcha") {
      const widget = WIDGETS[url.searchParams.get("widget") ?? "recaptcha"] ?? WIDGETS.recaptcha;
      return send(
        200,
        page(
          "Security check",
          `<h1>Security check</h1><p>Please verify you are human to continue.</p>${widget}`,
        ),
      );
    }
    if (path === "/blocked") {
      return send(
        403,
        page(
          "Access denied",
          "<h1>Access denied</h1><p>Access denied. Your request has been blocked.</p>",
        ),
      );
    }
    if (path === "/rate-limited") {
      return send(
        429,
        page(
          "Too many requests",
          "<h1>Too many requests</h1><p>Too many requests. Please slow down.</p>",
        ),
        { "retry-after": "60" },
      );
    }
    if (path === "/slow") {
      const ms = Math.min(Number(url.searchParams.get("ms")) || 5000, MAX_SLOW_MS);
      const timer = setTimeout(() => {
        timers.delete(timer);
        send(200, page("Slow page | Fake Supplier", `<h1>Slow page</h1>${ABOUT}`));
      }, ms);
      timers.add(timer);
      return;
    }
    const target = /^\/redirect\/([a-z]+)$/.exec(path)?.[1];
    if (target !== undefined && PRIVATE_TARGETS[target]) return redirect(PRIVATE_TARGETS[target]);
    if (path === "/redirect-to") {
      // Test only: a redirect to any address, so a test can aim it at a server it controls and prove it was never reached.
      const to = url.searchParams.get("url");
      return to ? redirect(to) : send(400, page("Bad request", "<p>Give a url.</p>"));
    }
    if (path === "/embeds-private") {
      return send(
        200,
        page(
          "Embeds | Fake Supplier",
          `<h1>Embeds</h1>${ABOUT}<img src="http://10.0.0.5/pixel.png" alt="">` +
            `<script>try { new WebSocket("ws://10.0.0.5/socket"); } catch (e) {}</script>`,
        ),
      );
    }
    if (path === "/webdriver-report") {
      // Says what the browser reports about itself, by asking for /seen/true or /seen/false. A test reads the request log.
      return send(
        200,
        page(
          "Report | Fake Supplier",
          `<h1>Report</h1>${ABOUT}<script>fetch("/seen/" + navigator.webdriver).catch(function () {});</script>`,
        ),
      );
    }
    if (/^\/seen\/(true|false)$/.test(path)) {
      res.writeHead(204);
      return void res.end();
    }
    if (path === "/links-private") {
      return send(
        200,
        page(
          "Links | Fake Supplier",
          `<h1>Links</h1>${ABOUT}<a href="http://10.0.0.5/">Our intranet</a>`,
        ),
      );
    }
    send(404, page("Not found", "<h1>Not found</h1><p>No such page.</p>"));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, resolve);
  });
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://${host}:${port}`,
    port,
    requests,
    expireSessions: () => sessions.clear(),
    async close() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      server.closeAllConnections(); // so a slow request does not hold the shutdown
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
