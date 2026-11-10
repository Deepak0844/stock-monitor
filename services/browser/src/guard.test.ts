import { describe, expect, it } from "vitest";
import type { HostLookup } from "@stock-monitor/supplier-session";
import { createGuard } from "./guard.js";

const answers = (map: Record<string, string[] | Error>): HostLookup => async (host) => {
  const a = map[host] ?? ["93.184.216.34"];
  if (a instanceof Error) throw a;
  return a;
};
const check = (host: string, port = 443, options: Parameters<typeof createGuard>[0] = {}) => createGuard({ lookup: answers({}), ...options }).check(host, port);

describe("createGuard: public targets are allowed, and the address to connect to is the one that was checked", () => {
  it("returns the address a name resolved to", async () => {
    expect(await check("shop.acme.example")).toEqual({ allowed: true, address: "93.184.216.34" });
  });
  it("uses a public IP address as it is, including IPv6", async () => {
    expect(await check("93.184.216.34")).toEqual({ allowed: true, address: "93.184.216.34" });
    expect(await check("[2606:4700::1111]")).toEqual({ allowed: true, address: "2606:4700::1111" });
  });
});

describe("createGuard: refuses private, loopback, link-local and metadata addresses", () => {
  it.each([
    "127.0.0.1", "10.0.0.5", "192.168.1.1", "172.16.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0",
    "[::1]", "[fe80::1]", "[fd00::1]", "[::ffff:127.0.0.1]", "[::ffff:a9fe:a9fe]",
    "2130706433", "0x7f000001", "0177.0.0.1", "127.1",
  ])("%s", async (host) => {
    expect(await check(host)).toEqual({ allowed: false, reason: "private" });
  });

  it("refuses a name when any of its addresses is private", async () => {
    expect(await check("sneaky.example", 443, { lookup: answers({ "sneaky.example": ["93.184.216.34", "10.0.0.7"] }) })).toEqual({ allowed: false, reason: "private" });
  });
  it("refuses localhost by name", async () => {
    expect((await check("localhost", 3000, { lookup: answers({ localhost: ["127.0.0.1", "::1"] }) })).allowed).toBe(false);
  });
  it("refuses a name that cannot be found, or that resolves to nothing", async () => {
    expect(await check("ghost.example", 443, { lookup: answers({ "ghost.example": new Error("ENOTFOUND") }) })).toEqual({ allowed: false, reason: "not_found" });
    expect(await check("empty.example", 443, { lookup: answers({ "empty.example": [] }) })).toEqual({ allowed: false, reason: "not_found" });
  });
  it("asks the DNS again every time, so a name cannot be changed between the check and the connection", async () => {
    let calls = 0;
    const guard = createGuard({ lookup: async () => (++calls === 1 ? ["93.184.216.34"] : ["10.0.0.5"]) });
    expect((await guard.check("rebind.example", 443)).allowed).toBe(true);
    expect((await guard.check("rebind.example", 443)).allowed).toBe(false);
  });
});

describe("createGuard: the test-only allow list", () => {
  it("lets through exactly the listed host and port, nothing else on the same machine", async () => {
    const options = { allowHosts: ["127.0.0.1:4000"] };
    expect(await check("127.0.0.1", 4000, options)).toEqual({ allowed: true, address: "127.0.0.1" });
    expect((await check("127.0.0.1", 4001, options)).allowed).toBe(false);
    expect((await check("127.0.0.1", 80, options)).allowed).toBe(false);
  });
});
