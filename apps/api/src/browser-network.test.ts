import { describe, expect, it } from "vitest";
import type { NetworkInterfaceInfo } from "node:os";
import { createBrowserNetworkGate } from "./browser-network.js";

const card = (address: string, cidr: string, internal = false) =>
  ({ address, cidr, internal, family: address.includes(":") ? "IPv6" : "IPv4", netmask: "", mac: "" }) as NetworkInterfaceInfo;

// The API's two networks in Docker: `default` (where the proxy's requests arrive) and `control` (shared with the browser).
const apiCards = () => ({ lo: [card("127.0.0.1", "127.0.0.1/8", true)], eth0: [card("172.20.0.4", "172.20.0.4/16")], eth1: [card("172.21.0.3", "172.21.0.3/16")] });

describe("createBrowserNetworkGate", () => {
  it("refuses a client on the browser service's network, and allows the others", async () => {
    const refuses = createBrowserNetworkGate({ host: "browser", resolve: async () => ["172.21.0.2"], interfaces: apiCards });
    expect(await refuses("172.21.0.2")).toBe(true);
    expect(await refuses("172.21.0.9")).toBe(true); // anything else on that network, the worker included
    expect(await refuses("::ffff:172.21.0.2")).toBe(true);
    expect(await refuses("172.20.0.1")).toBe(false); // the proxy, through the published port
    expect(await refuses("127.0.0.1")).toBe(false);
  });

  it("refuses nothing when the browser service runs on this machine", async () => {
    const refuses = createBrowserNetworkGate({ host: "localhost", resolve: async () => ["127.0.0.1"], interfaces: apiCards });
    expect(await refuses("127.0.0.1")).toBe(false);
  });

  it("refuses nothing while the browser service cannot be found, and looks again after a pause", async () => {
    let now = 0;
    let up = false;
    const refuses = createBrowserNetworkGate({
      host: "browser",
      resolve: async () => {
        if (!up) throw new Error("ENOTFOUND");
        return ["172.21.0.2"];
      },
      interfaces: apiCards,
      now: () => now,
    });
    expect(await refuses("172.21.0.2")).toBe(false);
    up = true;
    expect(await refuses("172.21.0.2")).toBe(false); // not looked up again yet
    now = 5_000;
    expect(await refuses("172.21.0.2")).toBe(true);
  });
});
