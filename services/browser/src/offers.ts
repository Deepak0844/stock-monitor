/** One offer from the page's built-in product data (schema.org). The same shape as the extraction package's `Offer`. */
export type PageOffer = { availability: string; url: string | null; sku: string | null; name: string | null };

const LIMITS = { maxOffers: 100, maxField: 200, maxNodes: 2000, maxScript: 1_000_000 };

/**
 * The offers in a page's built-in product data: the text of each `application/ld+json` script and each microdata
 * `availability` value. Only availability, address, SKU and name are kept. Bounded: at most 2000 values looked at per script,
 * 100 offers kept, each field cut to 200 characters, and a script over a million characters is never parsed. Broken JSON is
 * no data. Relative addresses resolve against `pageUrl`, the page's address after any redirects. Used by captures (on what
 * the browser saw) and by quick reads (on the downloaded HTML), so both read the same.
 */
export function offersFrom(jsonTexts: string[], microdata: string[], pageUrl: string): PageOffer[] {
  type Context = { url: string | null; sku: string | null; name: string | null };
  const offers: PageOffer[] = [];
  let nodes = 0;
  const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
  const field = (v: unknown): string | null => (typeof v === "string" || typeof v === "number" ? oneLine(String(v)).slice(0, LIMITS.maxField) || null : null);
  const address = (v: unknown): string | null => {
    const raw = field(v);
    if (!raw) return null;
    try {
      return new URL(raw, pageUrl).href.slice(0, LIMITS.maxField);
    } catch {
      return null;
    }
  };
  const valueName = (v: string) => (v.trim().split(/[/:]/).pop() ?? "").trim().slice(0, LIMITS.maxField);
  const types = (o: Record<string, unknown>): string[] => (Array.isArray(o["@type"]) ? o["@type"] : [o["@type"]]).filter((t): t is string => typeof t === "string").map(valueName);
  const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
  const addOffer = (o: Record<string, unknown>, ctx: Context) => {
    const availability = field(o.availability);
    if (!availability || offers.length >= LIMITS.maxOffers) return;
    offers.push({ availability: valueName(availability), url: address(o.url) ?? ctx.url, sku: field(o.sku) ?? ctx.sku, name: field(o.name) ?? ctx.name });
  };
  const walkOffers = (v: unknown, ctx: Context): void => {
    if (++nodes > LIMITS.maxNodes) return;
    if (Array.isArray(v)) return v.forEach((x) => walkOffers(x, ctx));
    if (!isObject(v)) return;
    if (v.offers !== undefined) walkOffers(v.offers, ctx); // an AggregateOffer that lists its offers
    addOffer(v, ctx);
  };
  const walk = (v: unknown, ctx: Context): void => {
    if (++nodes > LIMITS.maxNodes || offers.length >= LIMITS.maxOffers) return;
    if (Array.isArray(v)) return v.forEach((x) => walk(x, ctx));
    if (!isObject(v)) return;
    const t = types(v);
    if (t.includes("Product") || t.includes("ProductGroup")) {
      const own = { url: address(v.url) ?? ctx.url, sku: field(v.sku) ?? ctx.sku, name: field(v.name) ?? ctx.name };
      if (v.offers !== undefined) walkOffers(v.offers, own);
      if (v.hasVariant !== undefined) walk(v.hasVariant, own);
      return;
    }
    if (t.includes("Offer") || t.includes("AggregateOffer")) return walkOffers(v, ctx);
    for (const value of Object.values(v)) if (typeof value === "object") walk(value, ctx);
  };
  const none: Context = { url: null, sku: null, name: null };
  for (const text of jsonTexts) {
    nodes = 0; // each script gets its own budget, so a huge one cannot starve the product's own
    if (text.length > LIMITS.maxScript) continue; // never parse a giant blob
    try {
      walk(JSON.parse(text), none);
    } catch {
      // Broken built-in data is no built-in data.
    }
  }
  for (const value of microdata) {
    if (offers.length >= LIMITS.maxOffers) break;
    if (value) addOffer({ availability: value }, none);
  }
  return offers;
}
