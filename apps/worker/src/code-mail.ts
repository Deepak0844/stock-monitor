// Reading a supplier's login-code email: which email is the supplier's, and which characters in it are the code.
// Nothing here logs or keeps the text.

/** A code: 4 to 8 digits, or capitals and digits with at least one digit, standing on its own. */
const CANDIDATE = /\b(?=[A-Z0-9]*\d)[A-Z0-9]{4,8}\b/g;
const CODE_WORD = /\b(?:code|verification|one[- ]time|otp|passcode|pin|security)\b/gi;
const SIX_DIGITS = /\b\d{6}\b/g;
/** How far after a code word the code may sit. */
const NEAR = 60;

/** The login code in an email's subject and text, or null when there is none, or more than one could be it. */
export function findCode(text: string): string | null {
  const candidates = [...text.matchAll(CANDIDATE)].map((m) => ({ value: m[0], at: m.index }));
  for (const word of text.matchAll(CODE_WORD)) {
    const end = word.index + word[0].length;
    const near = candidates.find((c) => c.at >= end && c.at - end <= NEAR);
    if (near) return near.value;
  }
  const six = new Set([...text.matchAll(SIX_DIGITS)].map((m) => m[0]));
  return six.size === 1 ? [...six][0]! : null;
}

/** The registrable part of a host: two labels, three for a country's "co.uk"-style suffix. The same rule as the browser service's. */
export function siteOf(host: string): string {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (/^[\d.]+$/.test(h) || h.includes(":")) return h;
  const labels = h.split(".");
  const keep = labels.length > 2 && labels.at(-1)!.length === 2 && labels.at(-2)!.length <= 3 ? 3 : 2;
  return labels.slice(-keep).join(".");
}

const domainOf = (address: string) => address.slice(address.lastIndexOf("@") + 1).toLowerCase();

/**
 * Whether an email from `from` (a bare address) is this supplier's. By default its domain's site is the website's site.
 * The supplier's code email sender, when set, is used instead: a domain matches by site, an address exactly (any case).
 */
export function senderMatches(from: string, websiteUrl: string, override: string | null): boolean {
  if (override) return override.includes("@") ? from.toLowerCase() === override.toLowerCase() : siteOf(domainOf(from)) === siteOf(override);
  try {
    return siteOf(domainOf(from)) === siteOf(new URL(websiteUrl).hostname);
  } catch {
    return false;
  }
}
