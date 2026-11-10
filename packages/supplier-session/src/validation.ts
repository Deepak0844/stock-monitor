import { promises as dns } from "node:dns";
import { BlockList, isIP, isIPv6 } from "node:net";

export type SupplierUrlResult = { ok: true; url: string; host: string } | { ok: false; message: string };
export type HostCheckResult = { ok: true } | { ok: false; message: string };
/** Returns every address a name resolves to. Replaceable so tests need no network. */
export type HostLookup = (host: string) => Promise<string[]>;

const MAX_LENGTH = 2048;

const MESSAGES = {
  https: "Enter the supplier's website address starting with https://, like https://shop.example.com.",
  tooLong: "That address is too long.",
  characters: "That address has characters that are not allowed. Use only plain letters, numbers and standard symbols.",
  credentials: "Remove the username or password from the address. The app never stores supplier passwords.",
  port: "Use the standard web address without a port number.",
  ip: "Use the website's name, not an IP address.",
  notPublic: "That is not a public website. Enter the supplier's real website address, like https://shop.example.com.",
  notFound: "We could not find that website. Check the address and try again.",
  private: "That address points to a private or internal network, so it cannot be used.",
};

const LOCAL_SUFFIXES = [".localhost", ".local", ".localdomain", ".internal", ".intranet", ".lan", ".home.arpa"];

/**
 * The only way a supplier address gets into the app. The browser service will visit it, so anything
 * that is not a plain public https website name is refused. Returns the cleaned address.
 * It does not look the name up in DNS: use verifyPublicHost for that.
 */
export function validateSupplierUrl(input: unknown): SupplierUrlResult {
  if (typeof input !== "string") return { ok: false, message: MESSAGES.https };
  const value = input.trim();
  if (!value) return { ok: false, message: MESSAGES.https };
  if (value.length > MAX_LENGTH) return { ok: false, message: MESSAGES.tooLong };
  // The URL parser silently drops tabs and newlines and treats \ as /, so refuse them outright.
  // Anything outside printable ASCII is refused too, which covers look-alike and full-width characters.
  if (value.includes("\\") || /[^\x21-\x7e]/.test(value)) return { ok: false, message: MESSAGES.characters };

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, message: MESSAGES.https };
  }
  if (url.protocol !== "https:") return { ok: false, message: MESSAGES.https };
  if (url.username || url.password) return { ok: false, message: MESSAGES.credentials };
  if (url.port) return { ok: false, message: MESSAGES.port };

  const host = url.hostname.replace(/\.$/, "");
  if (host.split(".").some((label) => label.startsWith("xn--"))) return { ok: false, message: MESSAGES.characters };
  // The parser turns 2130706433, 0x7f000001 and 127.1 into 127.0.0.1, so one check covers them all.
  if (host.startsWith("[") || isIP(host)) return { ok: false, message: MESSAGES.ip };
  if (!host.includes(".") || host === "localhost" || LOCAL_SUFFIXES.some((s) => host.endsWith(s))) {
    return { ok: false, message: MESSAGES.notPublic };
  }

  url.hostname = host;
  url.hash = "";
  return { ok: true, url: url.href, host };
}

const privateRanges = new BlockList();
for (const [net, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) privateRanges.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [["::", 128], ["::1", 128], ["fe80::", 10], ["fc00::", 7], ["ff00::", 8], ["64:ff9b::", 96]] as const) {
  privateRanges.addSubnet(net, bits, "ipv6");
}

/** True for loopback, private, link-local, cloud-metadata and other non-public addresses. Unreadable text counts as private. */
export function isPrivateAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 0) return true;
  if (kind === 4) return privateRanges.check(address, "ipv4");
  // An IPv4 address wrapped in IPv6 (::ffff:a.b.c.d, or ::ffff:7f00:1 once normalised) is judged as the IPv4 address.
  const normal = isIPv6(address) ? new URL(`http://[${address}]`).hostname : address;
  const mapped = /^\[::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})\]$/.exec(normal);
  if (mapped) {
    const [high, low] = [parseInt(mapped[1] as string, 16), parseInt(mapped[2] as string, 16)];
    return privateRanges.check(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`, "ipv4");
  }
  return privateRanges.check(address, "ipv6");
}

/** The real DNS lookup. Services use it by default. */
export const systemLookup: HostLookup = async (host) => (await dns.lookup(host, { all: true })).map((a) => a.address);

/** Looks the name up and refuses it if it is unknown or if any address it resolves to is not public. */
export async function verifyPublicHost(host: string, lookup: HostLookup = systemLookup): Promise<HostCheckResult> {
  let addresses: string[];
  try {
    addresses = await lookup(host);
  } catch {
    return { ok: false, message: MESSAGES.notFound };
  }
  if (addresses.length === 0) return { ok: false, message: MESSAGES.notFound };
  if (addresses.some(isPrivateAddress)) return { ok: false, message: MESSAGES.private };
  return { ok: true };
}
