// Reading a supplier's login-code email: which email is the supplier's, and which characters in it are the code.
// Nothing here logs or keeps the text.

/** A code: 4 to 8 digits, or capitals and digits with at least one digit, standing on its own. */
const CANDIDATE = /\b(?=[A-Z0-9]*\d)[A-Z0-9]{4,8}\b/g;
/** Words right before a code. The strong ones name the code itself; the weak ones only the subject ("verification"). */
const STRONG_WORD = /\b(?:code|otp|passcode|pin)\b/gi;
const WEAK_WORD = /\b(?:verification|one[- ]time|security)\b/gi;
const SIX_DIGITS = /\b\d{6}\b/g;
const YEAR = /^(?:19|20)\d{2}$/;
/** How far after a code word the code may sit. */
const NEAR = 60;

type Candidate = { value: string; at: number };

/** The candidate nearest after any of these words, within NEAR. A year counts only right after the word ("code 2019"). */
function nearestAfter(text: string, words: RegExp, candidates: Candidate[]): string | null {
  let best: { value: string; gap: number } | null = null;
  for (const word of text.matchAll(words)) {
    const end = word.index + word[0].length;
    for (const c of candidates) {
      const gap = c.at - end;
      if (gap < 0 || gap > NEAR || (YEAR.test(c.value) && gap > 3)) continue;
      if (!best || gap < best.gap) best = { value: c.value, gap };
      break; // candidates are in order: the first one after this word is the nearest to it
    }
  }
  return best?.value ?? null;
}

/** The login code in an email's subject and text, or null when there is none, or more than one could be it. */
export function findCode(text: string): string | null {
  const candidates = [...text.matchAll(CANDIDATE)].map((m) => ({ value: m[0], at: m.index }));
  const named = nearestAfter(text, STRONG_WORD, candidates) ?? nearestAfter(text, WEAK_WORD, candidates);
  if (named) return named;
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
