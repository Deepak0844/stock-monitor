// Plays the owner in a real browser against the running spike. Usage: OWNER_SECRET=... node drive.mjs <output folder>
import { chromium, devices } from "@playwright/test";
import { execSync } from "node:child_process";
import fs from "node:fs";

const BASE = "http://127.0.0.1:4191";
const SECRET = process.env.OWNER_SECRET;
const OUT = process.argv[2];
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const measurements = {};
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 15000) => { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => undefined); if (v) return v; if (Date.now() > end) return undefined; await sleep(250); } };
const headers = { cookie: `owner=${SECRET}`, "content-type": "application/json" };
const control = async (path, body) =>
  (await fetch(`${BASE}/control${path}`, { method: body ? "POST" : "GET", headers, body: body ? JSON.stringify(body) : undefined })).json();

const browser = await chromium.launch();
const ownerContext = async (extra = {}) => {
  const ctx = await browser.newContext(extra);
  await ctx.addCookies([
    { name: "owner", value: SECRET, domain: "127.0.0.1", path: "/" },
    { name: "owner", value: SECRET, domain: "localhost", path: "/" },
  ]);
  return ctx;
};

// ---- 1. Refusals, before any session exists
{
  const anon = await browser.newContext();
  const page = await anon.newPage();
  const home = await page.goto(BASE + "/");
  check("the page is refused without the owner cookie", home.status() === 401);
  const start = await fetch(BASE + "/api/start", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  check("starting a session is refused without the owner cookie", start.status === 401);
  const ws = await page.evaluate((u) => new Promise((resolve) => { const s = new WebSocket(u); s.onopen = () => resolve("opened"); s.onerror = () => resolve("refused"); s.onclose = () => resolve("refused"); }), BASE.replace("http", "ws") + "/screen");
  check("the screen connection is refused without the owner cookie", ws === "refused");
  await anon.close();

  const owner = await ownerContext();
  const op = await owner.newPage();
  await op.goto("http://localhost:4191/owner?secret=" + SECRET); // a different origin from the allowed one
  const wrongOrigin = await op.evaluate((u) => new Promise((resolve) => { const s = new WebSocket(u); s.onopen = () => resolve("opened"); s.onerror = () => resolve("refused"); s.onclose = () => resolve("refused"); }), "ws://localhost:4191/screen");
  check("the screen connection is refused from a different origin even with the cookie", wrongOrigin === "refused");
  await owner.close();
}

// ---- 2. The main flow
const ctx = await ownerContext();
const page = await ctx.newPage();
const cspProblems = [];
page.on("console", (m) => { if (/content security policy/i.test(m.text())) cspProblems.push(m.text().slice(0, 160)); });
page.on("pageerror", (e) => cspProblems.push("pageerror: " + e.message.slice(0, 160)));

const t0 = Date.now();
await page.goto(`${BASE}/?target=${encodeURIComponent("http://site:8081/login")}`);
const connected = await until(() => page.evaluate(() => window.__state === "connected"), 90000);
measurements.secondsUntilWindowVisible = Math.round((Date.now() - t0) / 100) / 10;
check("the live window connects through the proxy", !!connected, `${measurements.secondsUntilWindowVisible}s from request to a visible window`);
check("no content-security-policy problem with a same-origin WebSocket", cspProblems.length === 0, cspProblems.join(" | "));
await sleep(1500);
await page.locator("#screen canvas").screenshot({ path: `${OUT}/01-connected.png` });

const info = await control("/debug/info");
check("the browser runs as a non-root user", info.uid !== 0, `uid ${info.uid}, chromium ${info.chromium}, no-sandbox flag: ${info.noSandboxFlag}`);
measurements.chromium = info.chromium;
measurements.noSandboxFlagUsed = info.noSandboxFlag;

const second = await fetch(BASE + "/api/start", { method: "POST", headers, body: JSON.stringify({ url: "http://site:8081/login" }) });
check("a second session is refused while one is open", second.status !== 200, `HTTP ${second.status}`);

const token = await page.evaluate(() => window.__token);
// a token is single use: the page already used it, so a second use must fail
const reuse = await page.evaluate((args) => new Promise((resolve) => { const s = new WebSocket(args.u); s.onopen = () => s.send(args.t); s.onmessage = (e) => resolve(e.data === "ok" ? "accepted" : "other"); s.onclose = () => resolve("refused"); setTimeout(() => resolve("refused"), 4000); }), { u: BASE.replace("http", "ws") + "/screen", t: token ?? "missing" });
check("a used token cannot be used again", reuse === "refused");
const wrong = await page.evaluate((u) => new Promise((resolve) => { const s = new WebSocket(u); s.onopen = () => s.send("not-a-real-token"); s.onmessage = () => resolve("accepted"); s.onclose = () => resolve("refused"); setTimeout(() => resolve("refused"), 4000); }), BASE.replace("http", "ws") + "/screen");
check("a wrong token is refused", wrong === "refused");

// typing through the remote screen: real keystrokes into the noVNC canvas
await page.evaluate(() => window.__rfb.focus());
await control("/debug/focus", { selector: "#username" });
await page.keyboard.type("tomsmith", { delay: 40 });
await page.keyboard.press("Tab");
await page.keyboard.type("SuperSecretPassword!", { delay: 40 });
check("typing into the remote page works", (await control("/debug/value?selector=%23password")).value === "SuperSecretPassword!");
await page.keyboard.press("Enter");
const loggedIn = await until(async () => (await control("/debug/url")).url.endsWith("/secure"), 10000);
check("a manual-style login through the live window succeeds", !!loggedIn);
await sleep(800);
await page.locator("#screen canvas").screenshot({ path: `${OUT}/02-logged-in.png` });

// clipboard: noVNC's paste into the remote clipboard, then Ctrl+V in the remote page
await control("/goto", { url: "http://site:8081/paste" });
await control("/debug/focus", { selector: "#paste" });
await page.evaluate(() => window.__rfb.focus());
await page.evaluate(() => window.__rfb.clipboardPasteFrom("clipboard-text-42"));
await sleep(500);
await page.keyboard.press("Control+v");
const pasted = await until(async () => (await control("/debug/value?selector=%23paste")).value, 4000);
check("pasting text into the remote page with Ctrl+V works", pasted === "clipboard-text-42", pasted ? `got "${pasted}"` : "nothing arrived");

// a CAPTCHA widget renders (it is only looked at, never solved)
await control("/goto", { url: "https://www.google.com/recaptcha/api2/demo" });
const widget = await until(async () => (await control("/debug/has?selector=" + encodeURIComponent('iframe[src*="recaptcha"]'))).count > 0, 25000);
check("a public CAPTCHA widget renders in the remote window", !!widget);
await sleep(1500);
await page.locator("#screen canvas").screenshot({ path: `${OUT}/03-captcha-widget.png` });

// memory and sizes while the window is open
try {
  const stats = execSync(`docker stats --no-stream --format '{{.Name}}: {{.MemUsage}} {{.CPUPerc}}' spike-browser-1 spike-proxy-1`).toString().trim();
  measurements.dockerStats = stats.split("\n");
  measurements.images = execSync(`docker image ls --format '{{.Repository}}: {{.Size}}' | grep -E '^spike-' `).toString().trim().split("\n");
} catch { /* measurements are best effort */ }

// ---- 3. Save and reuse the session
await control("/goto", { url: "http://site:8081/secure" });
const state = await control("/finish", {});
check("the session state has the supplier's cookie", state.cookies?.some((c) => c.name === "session"), `${state.cookies?.length ?? 0} cookie(s)`);
check("the browser is closed after finishing", (await fetch(BASE + "/control/debug/url", { headers })).status === 500);

const good = await control("/verify", { url: "http://site:8081/secure", state });
check("a fresh headless context with the saved state reaches the logged-in page", good.finalUrl?.endsWith("/secure") && good.heading === "Secure Area", good.finalUrl);
const bare = await control("/verify", { url: "http://site:8081/secure", state: { cookies: [], origins: [] } });
check("a context without the state is sent to the login page", bare.finalUrl?.endsWith("/login"), bare.finalUrl);
await control("/verify", { url: "http://site:8081/expire", state: { cookies: [], origins: [] } });
const expired = await control("/verify", { url: "http://site:8081/secure", state });
check("after the supplier expires the session, the saved state is detected as no longer working", expired.finalUrl?.endsWith("/login"), expired.finalUrl);

// ---- 4. Phone-sized screen
{
  const phoneCtx = await ownerContext({ ...devices["Pixel 7"] });
  const pp = await phoneCtx.newPage();
  await pp.goto(`${BASE}/?target=${encodeURIComponent("http://site:8081/login")}`);
  const ok = await until(() => pp.evaluate(() => window.__state === "connected"), 60000);
  check("the live window also connects on a phone-sized screen", !!ok);
  await sleep(1500);
  const overflow = await pp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("the phone-sized page does not scroll sideways", overflow <= 0, `overflow ${overflow}px`);
  await pp.screenshot({ path: `${OUT}/04-phone.png` });
  await control("/finish", {});
  await phoneCtx.close();
}

await ctx.close();
await browser.close();
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ measurements, results }, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`);
console.log("measurements:", JSON.stringify(measurements));
process.exit(failed.length ? 1 : 0);
