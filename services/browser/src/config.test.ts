import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const TOKEN = "k".repeat(40);

describe("loadConfig", () => {
  it("reads the token and uses sensible defaults", () => {
    expect(loadConfig({ CONTROL_TOKEN: TOKEN })).toEqual({
      token: TOKEN, port: 8080, host: "0.0.0.0", sandbox: true, headed: true, sessionTimeoutMs: 15 * 60_000, allowHosts: undefined,
    });
  });
  it.each([[undefined], [""], ["short"], ["x".repeat(31)]])("refuses a control token of %j", (token) => {
    expect(() => loadConfig({ CONTROL_TOKEN: token })).toThrow(/CONTROL_TOKEN/);
  });
  it("reads the port, and refuses nonsense", () => {
    expect(loadConfig({ CONTROL_TOKEN: TOKEN, PORT: "9000" }).port).toBe(9000);
    for (const port of ["abc", "0", "70000", "-1", "80.5"]) expect(() => loadConfig({ CONTROL_TOKEN: TOKEN, PORT: port }), port).toThrow(/PORT/);
  });
  it("turns Chromium's sandbox off only when told to", () => {
    expect(loadConfig({ CONTROL_TOKEN: TOKEN, NO_SANDBOX: "1" }).sandbox).toBe(false);
    expect(loadConfig({ CONTROL_TOKEN: TOKEN, NO_SANDBOX: "0" }).sandbox).toBe(true);
  });
  it("shows the live window in a real display unless told to run headless", () => {
    expect(loadConfig({ CONTROL_TOKEN: TOKEN, HEADLESS_WINDOWS: "1" }).headed).toBe(false);
  });
  it("reads the session time limit in minutes", () => {
    expect(loadConfig({ CONTROL_TOKEN: TOKEN, SESSION_MINUTES: "5" }).sessionTimeoutMs).toBe(5 * 60_000);
    expect(() => loadConfig({ CONTROL_TOKEN: TOKEN, SESSION_MINUTES: "0" })).toThrow(/SESSION_MINUTES/);
  });
  it("accepts the test-only allow list outside production", () => {
    expect(loadConfig({ CONTROL_TOKEN: TOKEN, NODE_ENV: "test", TEST_ALLOW_HOSTS: "host.docker.internal:4000, 127.0.0.1:5000" }).allowHosts).toEqual(["host.docker.internal:4000", "127.0.0.1:5000"]);
  });
  it("refuses to start in production with the test-only allow list set, because it would let private addresses through", () => {
    expect(() => loadConfig({ CONTROL_TOKEN: TOKEN, NODE_ENV: "production", TEST_ALLOW_HOSTS: "127.0.0.1:1" })).toThrow(/TEST_ALLOW_HOSTS/);
    expect(() => loadConfig({ CONTROL_TOKEN: TOKEN, TEST_ALLOW_HOSTS: "127.0.0.1:1" })).toThrow(/TEST_ALLOW_HOSTS/); // NODE_ENV unset counts as production
  });
});
