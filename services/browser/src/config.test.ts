import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const TOKEN = "k".repeat(40);
const VNC = "Ab3dE6gH";
const base = { CONTROL_TOKEN: TOKEN, VNC_PASSWORD: VNC };

describe("loadConfig", () => {
  it("reads the token and uses sensible defaults", () => {
    expect(loadConfig(base)).toEqual({
      token: TOKEN,
      port: 8080,
      host: "0.0.0.0",
      sandbox: true,
      headed: true,
      sessionTimeoutMs: 15 * 60_000,
      allowHosts: undefined,
      vncPassword: VNC,
      loginWindowMode: "controlled",
      verifyMode: "headless",
    });
  });
  it.each([[undefined], [""], ["short"], ["x".repeat(31)]])(
    "refuses a control token of %j",
    (token) => {
      expect(() => loadConfig({ ...base, CONTROL_TOKEN: token })).toThrow(/CONTROL_TOKEN/);
    },
  );
  it("reads the port, and refuses nonsense", () => {
    expect(loadConfig({ ...base, PORT: "9000" }).port).toBe(9000);
    for (const port of ["abc", "0", "70000", "-1", "80.5"])
      expect(() => loadConfig({ ...base, PORT: port }), port).toThrow(/PORT/);
  });
  it("turns Chromium's sandbox off only when told to", () => {
    expect(loadConfig({ ...base, NO_SANDBOX: "1" }).sandbox).toBe(false);
    expect(loadConfig({ ...base, NO_SANDBOX: "0" }).sandbox).toBe(true);
  });
  it("shows the live window in a real display unless told to run headless, and then needs no VNC password", () => {
    expect(loadConfig({ CONTROL_TOKEN: TOKEN, HEADLESS_WINDOWS: "1" })).toMatchObject({
      headed: false,
      vncPassword: undefined,
    });
  });
  it.each([[undefined], [""], ["short"], ["toolong12"], ["has space"], ["sym!bols1"]])(
    "refuses a VNC password of %j when windows are shown",
    (password) => {
      expect(() => loadConfig({ CONTROL_TOKEN: TOKEN, VNC_PASSWORD: password })).toThrow(
        /VNC_PASSWORD/,
      );
    },
  );
  it("reads the session time limit in minutes", () => {
    expect(loadConfig({ ...base, SESSION_MINUTES: "5" }).sessionTimeoutMs).toBe(5 * 60_000);
    expect(() => loadConfig({ ...base, SESSION_MINUTES: "0" })).toThrow(/SESSION_MINUTES/);
  });
  it("accepts the test-only allow list outside production", () => {
    expect(
      loadConfig({
        ...base,
        NODE_ENV: "test",
        TEST_ALLOW_HOSTS: "host.docker.internal:4000, 127.0.0.1:5000",
      }).allowHosts,
    ).toEqual(["host.docker.internal:4000", "127.0.0.1:5000"]);
  });
  it("refuses to start in production with the test-only allow list set, because it would let private addresses through", () => {
    expect(() =>
      loadConfig({ ...base, NODE_ENV: "production", TEST_ALLOW_HOSTS: "127.0.0.1:1" }),
    ).toThrow(/TEST_ALLOW_HOSTS/);
    expect(() => loadConfig({ ...base, TEST_ALLOW_HOSTS: "127.0.0.1:1" })).toThrow(
      /TEST_ALLOW_HOSTS/,
    ); // NODE_ENV unset counts as production
  });

  describe("the login window mode", () => {
    it("is controlled unless asked, which is how the window has always worked", () => {
      expect(loadConfig(base).loginWindowMode).toBe("controlled");
      expect(loadConfig({ ...base, LOGIN_WINDOW_MODE: "" }).loginWindowMode).toBe("controlled");
    });
    it.each(["controlled", "plain"])("accepts %s", (mode) => {
      expect(loadConfig({ ...base, LOGIN_WINDOW_MODE: mode }).loginWindowMode).toBe(mode);
    });
    it.each(["Plain", "stealth", "off", "true", "1"])(
      "refuses %j and names the setting, so a typo never silently picks a mode",
      (mode) => {
        expect(() => loadConfig({ ...base, LOGIN_WINDOW_MODE: mode })).toThrow(
          /LOGIN_WINDOW_MODE.*controlled.*plain/,
        );
      },
    );
  });

  describe("VERIFY_MODE (spike)", () => {
    it("is headless unless asked, and accepts profile", () => {
      expect(loadConfig({ ...base, VERIFY_MODE: "" }).verifyMode).toBe("headless");
      expect(loadConfig({ ...base, VERIFY_MODE: "profile" }).verifyMode).toBe("profile");
    });
    it("refuses anything else, and profile without a display", () => {
      expect(() => loadConfig({ ...base, VERIFY_MODE: "stealth" })).toThrow(/VERIFY_MODE/);
      expect(() => loadConfig({ ...base, VERIFY_MODE: "profile", HEADLESS_WINDOWS: "1" })).toThrow(/display/);
    });
  });
});
