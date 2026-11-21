import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";

/** True when the client at this address must be refused. */
export type ClientGate = (address: string | undefined) => Promise<boolean>;

const RETRY_MS = 5_000;

/**
 * Refuses every client on the network the API shares with the browser service. The API only ever calls the browser
 * service, never the other way round, so a request from there can only be a Chromium a supplier page took over.
 * The network is found, not configured: the API's own network card whose subnet holds the browser service's address.
 * A browser service on this machine (localhost) shares no separate network, so nothing is refused. While the browser
 * service cannot be found it is not running and nothing comes from it; the name is looked up again after a pause.
 */
export function createBrowserNetworkGate({
  host,
  resolve = async (name) => (await lookup(name, { all: true })).map((a) => a.address),
  interfaces = networkInterfaces,
  now = Date.now,
}: {
  host: string;
  resolve?: (host: string) => Promise<string[]>;
  interfaces?: () => NodeJS.Dict<NetworkInterfaceInfo[]>;
  now?: () => number;
}): ClientGate {
  let blocked: BlockList | undefined;
  let nextTry = 0;

  const find = async () => {
    const browser = await resolve(host);
    const holds = (cidr: string, address: string) => {
      const [net, bits] = cidr.split("/");
      const family = isIP(address) === 6 ? "ipv6" : "ipv4";
      if (isIP(net ?? "") !== isIP(address)) return false;
      const list = new BlockList();
      list.addSubnet(net as string, Number(bits), family);
      return list.check(address, family);
    };
    const list = new BlockList();
    let found = false;
    for (const card of Object.values(interfaces()).flat()) {
      if (!card || card.internal || !card.cidr || !browser.some((a) => holds(card.cidr as string, a))) continue;
      const [net, bits] = card.cidr.split("/");
      list.addSubnet(net as string, Number(bits), card.family === "IPv6" ? "ipv6" : "ipv4");
      found = true;
    }
    return found ? list : undefined;
  };

  return async (address) => {
    if (!address) return false;
    if (!blocked && now() >= nextTry) {
      nextTry = now() + RETRY_MS;
      blocked = await find().catch(() => undefined);
    }
    if (!blocked) return false;
    const bare = address.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, "");
    return blocked.check(bare, isIP(bare) === 6 ? "ipv6" : "ipv4");
  };
}
