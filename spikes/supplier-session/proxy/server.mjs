// Owner-only proxy: checks the cookie, the Origin and a one-time token, then pipes the screen.
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import crypto from "node:crypto";
import { WebSocketServer } from "ws";

const { OWNER_SECRET, ALLOWED_ORIGIN, BROWSER_CONTROL, VNC_HOST, VNC_PORT } = process.env;
const tokens = new Map(); // token -> { expires }
const CSP = "default-src 'self'; connect-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; frame-ancestors 'none'";
const isOwner = (req) => (req.headers.cookie ?? "").split(/;\s*/).includes(`owner=${OWNER_SECRET}`);
const log = (...a) => console.log(new Date().toISOString(), ...a);

const files = { "/": ["public/index.html", "text/html"], "/app.js": ["public/app.js", "text/javascript"], "/app.css": ["public/app.css", "text/css"] };

const server = http.createServer(async (req, res) => {
  res.setHeader("content-security-policy", CSP);
  res.setHeader("x-content-type-options", "nosniff");
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/owner" && url.searchParams.get("secret") === OWNER_SECRET) {
    res.writeHead(302, { "set-cookie": `owner=${OWNER_SECRET}; HttpOnly; SameSite=Lax; Path=/`, location: "/?target=" + encodeURIComponent(url.searchParams.get("target") ?? "http://site:8081/login") });
    return res.end();
  }
  if (files[url.pathname]) {
    if (!isOwner(req)) { res.writeHead(401); return res.end("Sign in first"); }
    const [file, type] = files[url.pathname];
    res.writeHead(200, { "content-type": type });
    return res.end(fs.readFileSync(file));
  }
  if (url.pathname.startsWith("/novnc/")) {
    if (!isOwner(req)) { res.writeHead(401); return res.end(); }
    const rel = url.pathname.replace("/novnc/", "");
    if (rel.includes("..")) { res.writeHead(400); return res.end(); }
    try { res.writeHead(200, { "content-type": "text/javascript" }); return res.end(fs.readFileSync("node_modules/@novnc/novnc/" + rel)); }
    catch { res.writeHead(404); return res.end(); }
  }
  if (url.pathname === "/api/start" && req.method === "POST") {
    if (!isOwner(req)) { res.writeHead(401); return res.end(); }
    let raw = ""; for await (const c of req) raw += c;
    const { url: target } = JSON.parse(raw || "{}");
    const r = await fetch(`${BROWSER_CONTROL}/open`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: target }) });
    if (!r.ok) { res.writeHead(502, { "content-type": "application/json" }); return res.end(JSON.stringify(await r.json())); }
    const token = crypto.randomBytes(32).toString("hex");
    tokens.set(token, { expires: Date.now() + 60_000 });
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ token }));
  }
  if (url.pathname.startsWith("/control/") && req.method === "POST") { // for the driver only: proxied debug calls
    if (!isOwner(req)) { res.writeHead(401); return res.end(); }
    let raw = ""; for await (const c of req) raw += c;
    const r = await fetch(BROWSER_CONTROL + url.pathname.replace("/control", ""), { method: "POST", headers: { "content-type": "application/json" }, body: raw || undefined });
    res.writeHead(r.status, { "content-type": "application/json" }); return res.end(await r.text());
  }
  if (url.pathname.startsWith("/control/") && req.method === "GET") {
    if (!isOwner(req)) { res.writeHead(401); return res.end(); }
    const r = await fetch(BROWSER_CONTROL + url.pathname.replace("/control", "") + url.search);
    res.writeHead(r.status, { "content-type": "application/json" }); return res.end(await r.text());
  }
  res.writeHead(404); res.end();
});

const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  if (req.url !== "/screen") { socket.destroy(); return; }
  if (!isOwner(req)) { log("refused: not signed in"); socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); socket.destroy(); return; }
  if (req.headers.origin !== ALLOWED_ORIGIN) { log("refused: origin", req.headers.origin); socket.write("HTTP/1.1 403 Forbidden\r\n\r\n"); socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => {
    const timer = setTimeout(() => ws.close(4001, "no token"), 5000);
    ws.once("message", (data) => {
      clearTimeout(timer);
      const token = data.toString();
      const entry = tokens.get(token);
      tokens.delete(token); // single use, even if it turns out to be expired
      if (!entry || entry.expires < Date.now()) { log("refused: bad, used or expired token"); ws.close(4003, "bad token"); return; }
      const tcp = net.connect(Number(VNC_PORT), VNC_HOST);
      tcp.once("connect", () => {
        ws.send("ok");
        ws.on("message", (d) => tcp.write(d));
        tcp.on("data", (d) => ws.send(d));
      });
      tcp.on("close", () => ws.close());
      tcp.on("error", () => ws.close());
      ws.on("close", () => tcp.destroy());
    });
  });
});
server.listen(4190, "0.0.0.0", () => log("proxy on 4190"));
