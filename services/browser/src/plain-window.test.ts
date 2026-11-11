import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { plainLaunchArgs, quitCleanly, seedProfile } from "./plain-window.js";

const options = {
  profile: "/tmp/p",
  proxyPort: 4321,
  url: "https://shop.acme.example/login",
  headless: false,
  sandbox: true,
};

describe("plainLaunchArgs", () => {
  it("starts an ordinary browser in its own profile, with the window where the screen is, at the address", () => {
    const args = plainLaunchArgs(options);
    expect(args).toEqual(
      expect.arrayContaining([
        "--user-data-dir=/tmp/p",
        "--window-position=0,0",
        "--window-size=1280,800",
        "--no-first-run",
        "--no-default-browser-check",
      ]),
    );
    expect(args.at(-1)).toBe("https://shop.acme.example/login");
  });

  it("sends everything through the guard listener, loopback included, so private addresses are refused", () => {
    const args = plainLaunchArgs(options);
    expect(args).toContain("--proxy-server=http://127.0.0.1:4321");
    expect(args).toContain("--proxy-bypass-list=<-loopback>");
  });

  it("opens no debugging channel, because any open channel makes the browser tell every page it is automated", () => {
    const args = plainLaunchArgs(options).join(" ");
    expect(args).not.toContain("--remote-debugging");
  });

  it("opens one only for a test, which has no mouse, on a free port that only this machine can reach", () => {
    const args = plainLaunchArgs({ ...options, debuggable: true });
    expect(args).toContain("--remote-debugging-port=0");
    expect(args.some((a) => a.startsWith("--remote-debugging-address"))).toBe(false);
    expect(args).not.toContain("--remote-allow-origins=*"); // a web page may never talk to it
  });

  it("keeps Chromium's sandbox on, and turns it off only when told the host cannot allow it", () => {
    expect(plainLaunchArgs(options)).not.toContain("--no-sandbox");
    expect(plainLaunchArgs({ ...options, sandbox: false })).toContain("--no-sandbox");
  });

  it("carries no automation switch, and does not touch the browser's identity", () => {
    const joined = plainLaunchArgs(options).join(" ");
    for (const forbidden of [
      "--enable-automation",
      "--remote-debugging-pipe",
      "--remote-debugging-port",
      "--user-agent",
      "--disable-blink-features",
      "--headless=old",
      "--enable-blink-features",
      "--lang=",
      "--disable-features=UserAgentClientHint",
      "AutomationControlled",
    ]) {
      expect(joined, forbidden).not.toContain(forbidden);
    }
  });

  it("runs with no display only when asked, for machines that have none", () => {
    expect(plainLaunchArgs(options).some((a) => a.startsWith("--headless"))).toBe(false);
    expect(plainLaunchArgs({ ...options, headless: true })).toContain("--headless=new");
  });
});

describe("seedProfile", () => {
  let dir = "";
  beforeEach(async () => (dir = await mkdtemp(join(tmpdir(), "seed-test-"))));
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("turns off saving passwords, autofill and sign-in before the browser first runs, so a typed password is never kept", async () => {
    await seedProfile(dir);
    const prefs = JSON.parse(await readFile(join(dir, "Default", "Preferences"), "utf8"));
    expect(prefs.credentials_enable_service).toBe(false);
    expect(prefs.profile.password_manager_enabled).toBe(false);
    expect(prefs.autofill).toEqual({ profile_enabled: false, credit_card_enabled: false });
    expect(prefs.signin.allowed).toBe(false);
  });

  it("keeps session cookies when the browser closes, so the login can be read from the profile", async () => {
    await seedProfile(dir);
    const prefs = JSON.parse(await readFile(join(dir, "Default", "Preferences"), "utf8"));
    expect(prefs.session.restore_on_startup).toBe(1);
  });

  it("also stops the offer to save a password and the check for the default browser", async () => {
    await seedProfile(dir);
    const prefs = JSON.parse(await readFile(join(dir, "Default", "Preferences"), "utf8"));
    expect(prefs.browser.check_default_browser).toBe(false);
    expect(prefs.profile.password_manager_leak_detection).toBe(false);
  });

  it("sets the owner's real language as the browser's language, and sets nothing when none is given", async () => {
    await seedProfile(dir, "en-IN");
    const prefs = JSON.parse(await readFile(join(dir, "Default", "Preferences"), "utf8"));
    expect(prefs.intl.accept_languages).toBe("en-IN,en");
    await seedProfile(dir);
    const plain = JSON.parse(await readFile(join(dir, "Default", "Preferences"), "utf8"));
    expect(plain.intl).toBeUndefined();
  });
});

describe("quitCleanly", () => {
  it("returns at once for a browser that was already killed by a signal", async () => {
    const child = spawn("sleep", ["60"], { detached: true, stdio: "ignore" });
    child.kill("SIGKILL");
    await new Promise((resolve) => child.once("exit", resolve));
    const done = await Promise.race([
      quitCleanly(child, 500).then(() => "returned"),
      new Promise((resolve) => setTimeout(() => resolve("still waiting"), 2000)),
    ]);
    expect(done).toBe("returned");
  });
});
