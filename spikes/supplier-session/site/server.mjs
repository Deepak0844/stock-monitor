// A tiny fake supplier: a login form, a cookie session, and a page that needs it.
import http from "node:http";
import crypto from "node:crypto";

const sessions = new Set();
const page = (body) => `<!doctype html><html><head><meta charset="utf-8"><title>Fake supplier</title></head><body style="font-family:sans-serif;padding:2rem">${body}</body></html>`;
const cookieOf = (req) => /(?:^|;\s*)session=([a-f0-9]+)/.exec(req.headers.cookie ?? "")?.[1];

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const html = (code, body, headers = {}) => {
      res.writeHead(code, { "content-type": "text/html", ...headers });
      res.end(page(body));
    };
    if (url.pathname === "/login" && req.method === "GET") {
      return html(200, `<h1>Login</h1><form method="post" action="/login"><label>Username <input id="username" name="username"></label><br><label>Password <input id="password" name="password" type="password"></label><br><button type="submit">Login</button></form>`);
    }
    if (url.pathname === "/login" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const form = new URLSearchParams(body);
        if (form.get("username") === "tomsmith" && form.get("password") === "SuperSecretPassword!") {
          const id = crypto.randomBytes(16).toString("hex");
          sessions.add(id);
          res.writeHead(302, { location: "/secure", "set-cookie": `session=${id}; HttpOnly; Path=/` });
          return res.end();
        }
        html(401, `<h1>Login</h1><p>Wrong details.</p><a href="/login">Try again</a>`);
      });
      return;
    }
    if (url.pathname === "/secure") {
      if (!sessions.has(cookieOf(req) ?? "")) {
        res.writeHead(302, { location: "/login" });
        return res.end();
      }
      return html(200, `<h1>Secure Area</h1><p>You are logged in.</p>`);
    }
    if (url.pathname === "/expire") {
      sessions.clear();
      return html(200, `<p>All sessions expired.</p>`);
    }
    if (url.pathname === "/paste") {
      return html(200, `<h1>Paste test</h1><input id="paste" autocomplete="off">`);
    }
    html(404, `<p>Not found</p>`);
  })
  .listen(8081, () => console.log("fake supplier on 8081"));
