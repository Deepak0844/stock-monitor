// The browser service inside its real container: Xvfb, VNC, Chromium with its sandbox on, as a non-root
// user. Builds the image under its own throw-away name and removes everything afterwards. Needs Docker.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createFakeSupplier, type FakeSupplier } from "@stock-monitor/supplier-session/testing";

vi.setConfig({ testTimeout: 180_000 });
const run = promisify(execFile);
// An empty screen is black, plus the mouse pointer. A window with a page in it has many more colours.
const EMPTY_SCREEN_MAX_COLOURS = 4;
const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const SUFFIX = randomBytes(4).toString("hex");
const IMAGE = `sm-browser-test:${SUFFIX}`;
const NAME = `sm-browser-test-${SUFFIX}`;
const TOKEN = randomBytes(24).toString("hex");
const PROBE = readFileSync(fileURLToPath(new URL("./rfb-probe.mjs", import.meta.url)), "utf8");

let site: FakeSupplier;
let loginUrl = "";

const docker = async (...args: string[]) => (await run("docker", args, { cwd: ROOT, maxBuffer: 50_000_000 })).stdout.trim();
const inside = (...args: string[]) => docker("exec", ...args);
const until = async (check: () => Promise<boolean>, ms: number, what: string) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check().catch(() => false)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${what}`);
};
const healthy = async () => (await docker("inspect", "--format", "{{.State.Health.Status}}", NAME)) === "healthy";

/** A call to the control API from inside the container, because its port is not published. */
const control = async (method: string, path: string, body?: unknown) => {
  const script =
    "const a=JSON.parse(process.env.ARGS);fetch('http://127.0.0.1:8080'+a.path,{method:a.method,headers:{authorization:'Bearer '+process.env.TOKEN,'content-type':'application/json'},body:a.body===undefined?undefined:JSON.stringify(a.body)})" +
    ".then(async r=>console.log(JSON.stringify({status:r.status,body:await r.text()})))";
  const out = await inside("-e", `TOKEN=${TOKEN}`, "-e", `ARGS=${JSON.stringify({ method, path, body })}`, NAME, "node", "-e", script);
  const parsed = JSON.parse(out) as { status: number; body: string };
  return { status: parsed.status, body: parsed.body ? (JSON.parse(parsed.body) as Record<string, any>) : {} }; // eslint-disable-line @typescript-eslint/no-explicit-any
};

/** Runs the stand-in VNC client inside the container, feeding it the script on stdin. */
const screen = () =>
  new Promise<{ banner: string; width: number; height: number; colours: number }>((resolve, reject) => {
    const child = spawn("docker", ["exec", "-i", NAME, "node", "--input-type=module", "-"], { cwd: ROOT });
    let out = "";
    child.stdout.on("data", (c) => (out += c));
    child.on("close", () => {
      try {
        resolve(JSON.parse(out));
      } catch {
        reject(new Error(`The VNC probe said: ${out}`));
      }
    });
    child.stdin.end(PROBE);
  });

const headedChromium = async () =>
  Number(await inside(NAME, "sh", "-c", "for p in /proc/[0-9]*; do tr '\\0' ' ' < $p/cmdline 2>/dev/null | grep -q '/ms-playwright/[c]hromium-[0-9]' && echo $p; done | wc -l"));
const profileFolders = async () => Number(await inside(NAME, "sh", "-c", "ls /tmp | grep -c playwright_chromiumdev_profile || true"));

async function startContainer() {
  await docker(
    "run", "-d", "--init", "--ipc=host",
    "--security-opt", `seccomp=${ROOT}services/browser/seccomp_profile.json`,
    "--add-host=host.docker.internal:host-gateway",
    "--name", NAME,
    "-e", `CONTROL_TOKEN=${TOKEN}`,
    // The fake supplier runs on this machine, which the guard would refuse. Only a non-production container accepts this.
    "-e", "NODE_ENV=test",
    "-e", `TEST_ALLOW_HOSTS=host.docker.internal:${site.port}`,
    IMAGE,
  );
  await until(healthy, 90_000, "the container to be healthy");
}

beforeAll(async () => {
  site = await createFakeSupplier({ host: "0.0.0.0" });
  loginUrl = `http://host.docker.internal:${site.port}/login`;
  await docker("build", "-f", "services/browser/Dockerfile", "-t", IMAGE, ".");
  await startContainer();
}, 600_000);
afterAll(async () => {
  await docker("rm", "-f", NAME).catch(() => {});
  await docker("rmi", IMAGE).catch(() => {});
  await site?.close();
}, 60_000);

describe("the container", () => {
  it("runs as a user that is not root, with no port published and no database or key", async () => {
    expect(await inside(NAME, "id", "-u")).not.toBe("0");
    expect(await docker("inspect", "--format", "{{json .NetworkSettings.Ports}}", NAME)).not.toContain("HostPort");
    expect(await docker("port", NAME)).toBe("");
    expect(await inside(NAME, "env")).not.toMatch(/DATABASE|POSTGRES|ENCRYPTION/i);
  });

  it("refuses a request with no token", async () => {
    const out = await inside(NAME, "node", "-e", "fetch('http://127.0.0.1:8080/sessions',{method:'POST'}).then(r=>console.log(r.status))");
    expect(out).toBe("401");
  });

  it("shares an empty virtual screen over VNC, readable by a stand-in client", async () => {
    const frame = await screen();
    expect(frame.banner).toMatch(/^RFB 003\.\d{3}$/);
    expect([frame.width, frame.height]).toEqual([1280, 800]);
    expect(frame.colours).toBeLessThanOrEqual(EMPTY_SCREEN_MAX_COLOURS);
  });
});

describe("a login window", () => {
  let id = "";
  let baseline = 0;

  it("opens a headed Chromium that really appears on the shared screen", async () => {
    baseline = await profileFolders();
    expect(await headedChromium()).toBe(0);
    const r = await control("POST", "/sessions", { url: loginUrl });
    expect(r.status).toBe(201);
    id = r.body.id as string;
    await until(async () => (await screen()).colours > 20, 20_000, "the window to be drawn on the screen");
    expect(await headedChromium()).toBeGreaterThan(0);
  });

  it("refuses a second window with a plain message", async () => {
    const r = await control("POST", "/sessions", { url: loginUrl });
    expect(r.status).toBe(409);
    expect(r.body.message).toBe("A login window is already open. Finish or cancel it first.");
  });

  it("finishes, returns a session, and leaves no Chromium, no profile and an empty screen", async () => {
    const r = await control("POST", `/sessions/${id}/finish`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.state.cookies)).toBe(true);
    await until(async () => (await headedChromium()) === 0, 15_000, "Chromium to exit");
    expect(await profileFolders()).toBe(baseline);
    expect((await screen()).colours).toBeLessThanOrEqual(EMPTY_SCREEN_MAX_COLOURS);
  });

  it("cancels another window the same clean way", async () => {
    const r = await control("POST", "/sessions", { url: loginUrl });
    expect(r.status).toBe(201);
    expect((await control("DELETE", `/sessions/${r.body.id}`)).status).toBe(204);
    await until(async () => (await headedChromium()) === 0, 15_000, "Chromium to exit");
    expect(await profileFolders()).toBe(baseline);
  });

  it("works again after the container is restarted, because the stale X lock is cleared", async () => {
    await docker("restart", NAME);
    await until(healthy, 90_000, "the container to be healthy again");
    const r = await control("POST", "/sessions", { url: loginUrl });
    expect(r.status).toBe(201);
    expect((await control("DELETE", `/sessions/${r.body.id}`)).status).toBe(204);
  });
});
