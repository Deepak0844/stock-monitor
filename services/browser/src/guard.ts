import { isIP } from "node:net";
import { isPrivateAddress, systemLookup, type HostLookup } from "@stock-monitor/supplier-session";

/** `address` is the one to connect to. Connecting to exactly that address, not looking the name up again, is what stops DNS rebinding. */
export type GuardVerdict = { allowed: true; address: string } | { allowed: false; reason: "private" | "not_found" };
export type Guard = { check(host: string, port: number): Promise<GuardVerdict> };
export type GuardOptions = {
  lookup?: HostLookup;
  /** Test only: "host:port" pairs let through even though they are on this machine. The service's real entry point never sets it. */
  allowHosts?: string[];
};

/** Decides whether the browser may connect to a host. Every connection the browser makes passes through this. */
export function createGuard({ lookup = systemLookup, allowHosts = [] }: GuardOptions = {}): Guard {
  return {
    async check(host, port) {
      // Let the URL parser read the host, so 2130706433, 0x7f000001 and 127.1 all become 127.0.0.1 before the check.
      let bare: string;
      try {
        bare = new URL(`http://${host}`).hostname.replace(/^\[|\]$/g, "");
      } catch {
        return { allowed: false, reason: "not_found" };
      }
      if (allowHosts.includes(`${bare}:${port}`)) return { allowed: true, address: bare };
      if (isIP(bare)) return isPrivateAddress(bare) ? { allowed: false, reason: "private" } : { allowed: true, address: bare };

      let addresses: string[];
      try {
        addresses = await lookup(bare);
      } catch {
        return { allowed: false, reason: "not_found" };
      }
      const [first] = addresses;
      if (first === undefined) return { allowed: false, reason: "not_found" };
      if (addresses.some(isPrivateAddress)) return { allowed: false, reason: "private" };
      return { allowed: true, address: first };
    },
  };
}
