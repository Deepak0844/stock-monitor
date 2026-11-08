// The browser service as Docker Compose runs it. First the resolved configuration is read, then a whole separate
// Compose project is started (its own name, image tags, volume, network, env file and a random host port, so the
// owner's running stack is never touched) and the running containers are inspected and used.
// Needs Docker with Compose. It reads no .env: it passes its own env file.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

vi.setConfig({ testTimeout: 240_000, hookTimeout: 900_000 });
const run = promisify(execFile);
const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const SUFFIX = randomBytes(4).toString("hex");
const PROJECT = `sm-compose-${SUFFIX}`;
const APP_IMAGE = `sm-compose-app:${SUFFIX}`;
const BROWSER_IMAGE = `sm-compose-browser:${SUFFIX}`;
const TOKEN = randomBytes(24).toString("hex");
const dir = mkdtempSync(join(tmpdir(), "sm-compose-"));
const ENV_FILE = join(dir, "env");
const OVERRIDE = join(dir, "override.yml");

const envLines = (extra: Record<string, string> = {}) =>
  Object.entries({
    POSTGRES_PASSWORD: randomBytes(12).toString("hex"),
    APP_DB_PASSWORD: randomBytes(12).toString("hex"),
    APP_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    BROWSER_CONTROL_TOKEN: TOKEN,
    COOKIE_SECURE: "false",
    ...extra,
  })
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

/** Docker Compose against this project's files and the test's own env file. It never reads the repository's .env. */
const compose = async (
  args: string[],
  opts: { project?: boolean; files?: string[]; envFile?: string } = {},
) =>
  (
    await run(
      "docker",
      [
        "compose",
        ...(opts.project === false ? [] : ["-p", PROJECT]),
        "-f",
        "docker-compose.yml",
        ...(opts.files ?? []).flatMap((f) => ["-f", f]),
        "--env-file",
        opts.envFile ?? ENV_FILE,
        ...args,
      ],
      { cwd: ROOT, maxBuffer: 100_000_000 },
    )
  ).stdout.trim();

type Service = {
  ports?: { host_ip?: string; published?: string; target: number }[];
  networks?: Record<string, unknown>;
  security_opt?: string[];
  cap_drop?: string[];
  cap_add?: string[];
  read_only?: boolean;
  volumes?: { type: string; source?: string }[];
  environment?: Record<string, string>;
  mem_limit?: string | number;
  pids_limit?: number;
  privileged?: boolean;
  tmpfs?: string[];
  restart?: string;
  ipc?: string;
};
type Config = {
  services: Record<string, Service>;
  networks: Record<string, { internal?: boolean } | null>;
};
let config: Config;

beforeAll(async () => {
  writeFileSync(ENV_FILE, envLines());
  config = JSON.parse(await compose(["config", "--format", "json"], { project: false })) as Config;
  // Everything the test starts has its own names. The published port is left to Docker to choose.
  writeFileSync(
    OVERRIDE,
    `services:
  migrate:
    image: ${APP_IMAGE}
  worker:
    image: ${APP_IMAGE}
  api:
    image: ${APP_IMAGE}
    ports: !override
      - "127.0.0.1::3000"
  browser:
    image: ${BROWSER_IMAGE}
`,
  );
}, 60_000);

describe("the resolved configuration", () => {
  it("refuses to start without a control token, and says which setting to fill in", async () => {
    const noToken = join(dir, "env-no-token");
    writeFileSync(
      noToken,
      envLines({ BROWSER_CONTROL_TOKEN: "" }).replace(/BROWSER_CONTROL_TOKEN=\n?/, ""),
    );
    await expect(compose(["config"], { project: false, envFile: noToken })).rejects.toThrow(
      /BROWSER_CONTROL_TOKEN/,
    );
  });

  it("publishes no port for the browser service, and only the API publishes one, on this machine only", () => {
    const published = Object.entries(config.services).filter(([, s]) => (s.ports ?? []).length > 0);
    expect(published.map(([name]) => name)).toEqual(["api"]);
    expect(config.services.browser?.ports ?? []).toEqual([]);
    expect(config.services.api?.ports).toEqual([
      expect.objectContaining({ host_ip: "127.0.0.1", target: 3000 }),
    ]);
  });

  it("puts the browser service on a private network shared with the API and worker, and on an outbound network of its own, never the default", () => {
    expect(Object.keys(config.services.browser?.networks ?? {}).sort()).toEqual([
      "control",
      "egress",
    ]);
    expect(config.networks.control?.internal).toBe(true); // no way out to the internet from this network
    expect(config.networks.egress?.internal).toBeFalsy();
    const onNetwork = (net: string) =>
      Object.entries(config.services)
        .filter(([, s]) => Object.keys(s.networks ?? { default: null }).includes(net))
        .map(([n]) => n)
        .sort();
    expect(onNetwork("control")).toEqual(["api", "browser", "worker"]);
    expect(onNetwork("egress")).toEqual(["browser"]);
    expect(onNetwork("default")).toEqual(["api", "migrate", "postgres", "worker"]); // the database never shares a network with the browser
  });

  it("locks the browser container down: no extra privileges, no capabilities but one, a read-only filesystem and Playwright's seccomp profile", () => {
    const b = config.services.browser!;
    expect(b.privileged).toBeFalsy();
    expect(b.cap_drop).toEqual(["ALL"]);
    expect(b.cap_add).toEqual(["SYS_CHROOT"]); // the one thing Chromium's own sandbox needs
    expect(b.read_only).toBe(true);
    expect(b.security_opt).toEqual(expect.arrayContaining(["no-new-privileges:true"]));
    expect(
      b.security_opt?.some((o) => o.startsWith("seccomp") && o.includes("seccomp_profile.json")),
    ).toBe(true);
    expect(b.ipc ?? "private").not.toBe("host"); // the host's shared memory is not opened to it
  });

  it("limits memory and processes, and mounts no host folder or volume", () => {
    const b = config.services.browser!;
    expect(Number(b.mem_limit)).toBeGreaterThan(0);
    expect(b.pids_limit).toBeGreaterThan(0);
    expect((b.volumes ?? []).filter((v) => v.type === "bind" || v.type === "volume")).toEqual([]);
  });

  it("gives the browser service the control token and no database credentials or encryption key", () => {
    const env = config.services.browser?.environment ?? {};
    expect(env.CONTROL_TOKEN).toBe(TOKEN);
    expect(
      Object.keys(env).filter((k) => /DATABASE|POSTGRES|DB_PASSWORD|ENCRYPTION/i.test(k)),
    ).toEqual([]);
  });

  it("passes the login window mode to the browser container, controlled unless the owner chose plain", () => {
    expect(config.services.browser?.environment?.LOGIN_WINDOW_MODE).toBe("controlled");
  });
  it("passes plain to the browser container when the env file says so", async () => {
    const plainEnv = join(dir, "env-plain");
    writeFileSync(plainEnv, envLines({ LOGIN_WINDOW_MODE: "plain" }));
    const out = await compose(["config", "--format", "json"], { project: false, envFile: plainEnv });
    const resolved = JSON.parse(out) as { services: Record<string, { environment?: Record<string, string> }> };
    expect(resolved.services.browser?.environment?.LOGIN_WINDOW_MODE).toBe("plain");
  });

  it("gives the API and worker the browser service's address and the same token", () => {
    for (const name of ["api", "worker"]) {
      const env = config.services[name]?.environment ?? {};
      expect(env.BROWSER_SERVICE_URL, name).toBe("http://browser:8080");
      expect(env.BROWSER_CONTROL_TOKEN, name).toBe(TOKEN);
    }
  });
});

describe("the running stack", () => {
  const inspect = async (service: string) => {
    const id = await compose(["ps", "-q", service]);
    return (JSON.parse((await run("docker", ["inspect", id])).stdout) as Record<string, any>[])[0]!; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const inService = (service: string, ...cmd: string[]) => compose(["exec", "-T", service, ...cmd]);
  /** A call from the API's container to the browser service, the way the API makes it. */
  const fromApi = async (
    method: string,
    path: string,
    opts: { token?: string | null; body?: unknown } = {},
  ) => {
    const script =
      "const a=JSON.parse(process.env.ARGS);fetch('http://browser:8080'+a.path,{method:a.method,headers:{...(a.token?{authorization:'Bearer '+a.token}:{}),'content-type':'application/json'},body:a.body===undefined?undefined:JSON.stringify(a.body)})" +
      ".then(async r=>console.log(JSON.stringify({status:r.status,body:await r.text()}))).catch(e=>console.log(JSON.stringify({error:String(e)})))";
    const out = await compose([
      "exec",
      "-T",
      "-e",
      `ARGS=${JSON.stringify({ method, path, token: opts.token === undefined ? TOKEN : opts.token, body: opts.body })}`,
      "api",
      "node",
      "-e",
      script,
    ]);
    const parsed = JSON.parse(out) as { status: number; body: string };
    return {
      status: parsed.status,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      json: parsed.body ? (JSON.parse(parsed.body) as Record<string, any>) : {},
    };
  };

  beforeAll(async () => {
    await compose(["up", "-d", "--build", "--wait", "--wait-timeout", "600"], {
      files: [OVERRIDE],
    });
  }, 900_000);
  afterAll(async () => {
    await compose(["down", "-v", "--remove-orphans", "--timeout", "10"], {
      files: [OVERRIDE],
    }).catch(() => {});
    await run("docker", ["rmi", APP_IMAGE, BROWSER_IMAGE]).catch(() => {});
    rmSync(dir, { recursive: true, force: true });
  }, 120_000);

  it("starts everything, and the browser service and API report healthy", async () => {
    for (const service of ["postgres", "api", "worker", "browser"])
      expect((await inspect(service)).State.Running, service).toBe(true);
    expect((await inspect("browser")).State.Health.Status).toBe("healthy");
    expect((await inspect("api")).State.Health.Status).toBe("healthy");
  });

  it("has no port published for the browser container, and is not on the default network", async () => {
    const b = await inspect("browser");
    expect(
      Object.values(b.NetworkSettings.Ports ?? {})
        .flat()
        .filter(Boolean),
    ).toEqual([]);
    expect(b.HostConfig.PortBindings ?? {}).toEqual({});
    expect(Object.keys(b.NetworkSettings.Networks).sort()).toEqual([
      `${PROJECT}_control`,
      `${PROJECT}_egress`,
    ]);
  });

  it("keeps the database on the default network only, with the API and worker on both", async () => {
    expect(Object.keys((await inspect("postgres")).NetworkSettings.Networks)).toEqual([
      `${PROJECT}_default`,
    ]);
    for (const s of ["api", "worker"])
      expect(Object.keys((await inspect(s)).NetworkSettings.Networks).sort(), s).toEqual([
        `${PROJECT}_control`,
        `${PROJECT}_default`,
      ]);
  });

  it("runs as a non-root user, with no privileges, one capability, a read-only root filesystem and no host folder", async () => {
    const b = await inspect("browser");
    expect(await inService("browser", "id", "-u")).not.toBe("0");
    expect(b.HostConfig.Privileged).toBe(false);
    expect(b.HostConfig.CapDrop).toEqual(["ALL"]);
    expect(b.HostConfig.CapAdd).toEqual(["CAP_SYS_CHROOT"]); // Docker spells it with the CAP_ prefix
    expect(b.HostConfig.ReadonlyRootfs).toBe(true);
    expect(b.HostConfig.SecurityOpt).toEqual(
      expect.arrayContaining(["no-new-privileges:true", expect.stringContaining("seccomp=")]),
    );
    expect(b.HostConfig.Memory).toBeGreaterThan(0);
    expect(b.HostConfig.PidsLimit).toBeGreaterThan(0);
    expect((b.Mounts as { Type: string }[]).filter((m) => m.Type === "bind")).toEqual([]);
  });

  it("holds no database credentials or encryption key, in its settings or its environment", async () => {
    const b = await inspect("browser");
    expect(
      (b.Config.Env as string[]).filter((e) =>
        /DATABASE|POSTGRES|DB_PASSWORD|ENCRYPTION/i.test(e.split("=")[0] ?? ""),
      ),
    ).toEqual([]);
    expect(await inService("browser", "env")).not.toMatch(
      /DATABASE|POSTGRES|DB_PASSWORD|ENCRYPTION/i,
    );
  });

  it("is reachable from the API over the private network, and needs the token", async () => {
    expect((await fromApi("GET", "/health", { token: null })).status).toBe(200);
    expect(
      (await fromApi("POST", "/sessions", { token: null, body: { url: "https://example.com/" } }))
        .status,
    ).toBe(401);
    expect((await fromApi("POST", "/verify", { token: "x".repeat(48), body: {} })).status).toBe(
      401,
    );
  });

  it("cannot reach the database, because it cannot even find it", async () => {
    await expect(inService("browser", "getent", "hosts", "postgres")).rejects.toThrow();
    await expect(inService("browser", "getent", "hosts", "migrate")).rejects.toThrow();
  });

  it("runs Chromium with its sandbox on, and checks a page from inside the locked-down container", async () => {
    // example.com is a public test page, not a supplier. If the outbound network were missing the answer would be
    // "unreachable", which still proves Chromium started and the service answered.
    const r = await fromApi("POST", "/verify", {
      body: { url: "https://example.com/", state: { cookies: [], origins: [] } },
    });
    expect(r.status).toBe(200);
    expect(["ok", "login_required", "captcha", "blocked", "unreachable", "unknown"]).toContain(
      r.json.result,
    );
    const flags = await inService(
      "browser",
      "sh",
      "-c",
      `for p in /proc/[0-9]*; do tr '\\0' ' ' < $p/cmdline 2>/dev/null | grep -q '[c]hrome-headless-shell' && echo yes; done | wc -l; for p in /proc/[0-9]*; do tr '\\0' '\\n' < $p/cmdline 2>/dev/null | grep -x -e '--no-sandbox' && echo FOUND; done; true`,
    );
    expect(Number(flags.split("\n")[0])).toBeGreaterThan(0);
    expect(flags).not.toContain("FOUND");
  });

  it("opens a login window with a visible Chromium, and the VNC screen answers from the API's side only", async () => {
    const opened = await fromApi("POST", "/sessions", { body: { url: "https://example.com/" } });
    expect(opened.status).toBe(201);
    expect(opened.json.vncPassword).toMatch(/^[A-Za-z0-9]{8}$/);
    const banner = await compose([
      "exec",
      "-T",
      "api",
      "node",
      "-e",
      "const s=require('net').connect(5900,'browser');s.once('data',d=>{console.log(d.toString().trim());process.exit(0)});s.once('error',()=>process.exit(1));setTimeout(()=>process.exit(2),5000)",
    ]);
    expect(banner).toMatch(/^RFB 003\.\d{3}$/);
    expect((await fromApi("DELETE", `/sessions/${opened.json.id}`)).status).toBe(204);
  });
});
