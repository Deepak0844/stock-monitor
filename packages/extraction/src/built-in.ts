import type { Answer } from "./types.js";
import { normaliseWords } from "./validate.js";

/** One offer from the page's built-in product data (schema.org). Only these four facts are ever kept. */
export type Offer = { availability: string; url: string | null; sku: string | null; name: string | null };
/** The link being checked: its own address (with its query string) and the supplier option the owner set on it. */
export type LinkRef = { url: string | null; option: string | null };
/** How pre-order and back-order count. */
export type Waiting = "in_stock" | "out_of_stock" | "cannot_tell";

type Kind = "in" | "out" | "waiting";
// schema.org ItemAvailability. Anything not listed (InStoreOnly, Reserved, a made-up value) is not clear.
const KINDS: Record<string, Kind> = {
  instock: "in",
  limitedavailability: "in",
  onlineonly: "in",
  outofstock: "out",
  soldout: "out",
  discontinued: "out",
  preorder: "waiting",
  presale: "waiting",
  backorder: "waiting",
  madetoorder: "waiting",
};

/** The value's own name: "https://schema.org/InStock", "schema:InStock" and "InStock" all give "InStock". */
export const availabilityName = (raw: string): string => raw.trim().split(/[/:]/).pop()?.trim() ?? "";

/** In stock, out of stock, or null when the value does not say clearly. */
export function availabilityAnswer(raw: string, waiting: Waiting): Answer | null {
  const kind = KINDS[availabilityName(raw).toLowerCase()];
  if (kind === "in") return "in_stock";
  if (kind === "out") return "out_of_stock";
  if (kind === "waiting") return waiting === "cannot_tell" ? null : waiting;
  return null;
}

const parse = (address: string, base?: string): URL | null => {
  try {
    return new URL(address, base);
  } catch {
    return null;
  }
};
const path = (url: URL) => url.pathname.replace(/\/+$/, "");

export type Picked = { answer: Answer; offer: Offer } | { unclear: "variant_unclear" | "built_in_unclear" };

/**
 * The answer the built-in data gives for this link, or null when the page has no offers. One offer, or offers that all say
 * the same, answer at once. Otherwise the offer must be found: by the `variant` value in the link's address, else by the
 * option the owner set on the link (the supplier's SKU or option name). Never a guess: no single match is "variant_unclear".
 */
export function pickOffer(offers: Offer[], link: LinkRef, waiting: Waiting): Picked | null {
  if (offers.length === 0) return null;
  const answers = offers.map((o) => availabilityAnswer(o.availability, waiting));
  const first = answers[0] ?? null;
  if (answers.every((a) => a === first)) return first === null ? { unclear: "built_in_unclear" } : { answer: first, offer: offers[0] as Offer };

  const found = (match: (o: Offer) => boolean): Picked | null => {
    const hits = offers.map((o, i) => [o, answers[i] ?? null] as const).filter(([o]) => match(o));
    if (hits.length !== 1) return null;
    const [offer, answer] = hits[0] as readonly [Offer, Answer | null];
    return answer === null ? { unclear: "built_in_unclear" } : { answer, offer };
  };

  const linkUrl = link.url ? parse(link.url) : null;
  const variant = linkUrl?.searchParams.get("variant");
  if (linkUrl && variant) {
    const hit = found((o) => {
      const u = o.url ? parse(o.url, linkUrl.href) : null;
      return u !== null && path(u) === path(linkUrl) && u.searchParams.get("variant") === variant;
    });
    if (hit) return hit;
  }
  const option = link.option ? normaliseWords(link.option) : "";
  if (option) {
    const hit = found((o) => (o.sku !== null && normaliseWords(o.sku) === option) || (o.name !== null && normaliseWords(o.name) === option));
    if (hit) return hit;
  }
  return { unclear: "variant_unclear" };
}
