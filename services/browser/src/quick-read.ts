import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { explainPage, looksLikeNotFound, type PageClass } from "@stock-monitor/supplier-session";
import type { Guard } from "./guard.js";
import { offersFrom, type PageOffer } from "./offers.js";
import { MAX_TEXT } from "./verify.js";

export type QuickReadOutcome = { result: PageClass; status: number | null; finalUrl: string | null; softNotFound: boolean; offers: PageOffer[]; signal: string; blocked: boolean };
export type QuickReadOptions = { guard: Guard; language?: string; timeoutMs?: number; maxBytes?: number; maxRedirects?: number };

const DEFAULTS = { timeoutMs: 10_000, maxBytes: 3_000_000, maxRedirects: 5 };
const USER_AGENT = "stock-monitor/1.0";
const MAX_SCRIPTS = 2_000_000;
const MAX_SCRIPT = 1_000_000;
const MAX_MICRODATA = 100;

const withoutQuery = (address: string): string | null => {
  try {
    const url = new URL(address);
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (whole, name: string) => {
    if (/^#x/i.test(name)) return String.fromCodePoint(parseInt(name.slice(2), 16) || 32);
    if (/^#\d/.test(name)) return String.fromCodePoint(Number(name.slice(1)) || 32);
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** What the classifier needs from the HTML, read with bounded patterns. Never kept or returned. */
function factsOf(htmlText: string) {
  const title = oneLine(decode(/<title\b[^>]*>([\s\S]{0,2000}?)<\/title>/i.exec(htmlText)?.[1] ?? ""));
  const text = oneLine(decode(htmlText.replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]*>/g, " "))).slice(0, MAX_TEXT);
  const inputs = htmlText.match(/<input\b[^>]*>/gi) ?? [];
  const hasPasswordField = inputs.some((tag) => /\btype\s*=\s*["']?password\b/i.test(tag) && !/\bhidden\b/i.test(tag.replace(/\btype\s*=\s*["']?password["']?/i, "")));
  const hasChallengeWidget = /class\s*=\s*["'][^"']*\b(h-captcha|g-recaptcha|cf-turnstile)\b|<iframe\b[^>]*\b(hcaptcha\.com|google\.com\/recaptcha|challenges\.cloudflare\.com)/i.test(htmlText);
  const ldScripts: string[] = [];
  let chars = 0;
  for (const m of htmlText.matchAll(/<script\b[^>]*\btype\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    const body = m[1] ?? "";
    if (body.length > MAX_SCRIPT || chars + body.length > MAX_SCRIPTS) continue;
    ldScripts.push(body);
    chars += body.length;
  }
  const microdata: string[] = [];
  for (const tag of htmlText.match(/<[a-z]+\b[^>]*\bitemprop\s*=\s*["']?availability\b[^>]*>/gi) ?? []) {
    if (microdata.length >= MAX_MICRODATA) break;
    const value = /\b(?:href|content)\s*=\s*["']([^"']{1,200})["']/i.exec(tag)?.[1];
    if (value) microdata.push(value);
  }
  return { title, text, hasPasswordField, hasChallengeWidget, ldScripts, microdata };
}

type Hop = { status: number; location: string | null; contentType: string; body: string | null; tooLarge: boolean };

/** One GET to an address the guard allowed. The connection goes to the checked address, never a fresh lookup. */
function fetchOnce(url: URL, address: string, options: { language?: string; maxBytes: number; signal: AbortSignal }): Promise<Hop> {
  return new Promise((resolve, reject) => {
    const lookup: LookupFunction = (_host, opts, callback) => {
      const family = address.includes(":") ? 6 : 4;
      if ((opts as { all?: boolean }).all) (callback as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [{ address, family }]);
      else callback(null, address, family);
    };
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = send(
      url,
      {
        method: "GET",
        lookup,
        // TLS checks the certificate against the name, while the connection goes to the checked address.
        ...(url.protocol === "https:" && !isIP(url.hostname.replace(/^\[|\]$/g, "")) ? { servername: url.hostname } : {}),
        headers: { accept: "text/html,application/xhtml+xml", "accept-encoding": "gzip, br, deflate", "user-agent": USER_AGENT, ...(options.language ? { "accept-language": options.language } : {}) },
        signal: options.signal,
      },
      (res: IncomingMessage) => {
        const status = res.statusCode ?? 0;
        const location = status >= 300 && status < 400 ? (res.headers.location ?? null) : null;
        const contentType = String(res.headers["content-type"] ?? "");
        if (location || !/text\/html|application\/xhtml/i.test(contentType)) {
          res.resume();
          return resolve({ status, location, contentType, body: null, tooLarge: false });
        }
        const encoding = String(res.headers["content-encoding"] ?? "").toLowerCase();
        const stream = encoding === "gzip" ? res.pipe(createGunzip()) : encoding === "br" ? res.pipe(createBrotliDecompress()) : encoding === "deflate" ? res.pipe(createInflate()) : res;
        const chunks: Buffer[] = [];
        let size = 0;
        stream.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > options.maxBytes) {
            req.destroy();
            resolve({ status, location: null, contentType, body: null, tooLarge: true });
            return;
          }
          chunks.push(chunk);
        });
        stream.on("end", () => resolve({ status, location: null, contentType, body: Buffer.concat(chunks).toString("utf8"), tooLarge: false }));
        stream.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end();
  });
}

/**
 * Downloads one page's HTML, with no browser, and reads its built-in offers. Every hop (the first address and each redirect)
 * passes the same guard as the browser, and the connection goes to the address the guard checked. Bounded: 5 redirects, 10 s
 * and 3 MB. The answer is what the page was and its offers, never its HTML. Only for suppliers whose pages need no login, so
 * login wording on a page is not a login wall; a password box, a login address, a puzzle or a block still count.
 */
export async function quickRead(address: string, options: QuickReadOptions): Promise<QuickReadOutcome> {
  const { guard, language } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs;
  const maxBytes = options.maxBytes ?? DEFAULTS.maxBytes;
  const maxRedirects = options.maxRedirects ?? DEFAULTS.maxRedirects;
  const nothing = (result: PageClass, signal: string, extra: Partial<QuickReadOutcome> = {}): QuickReadOutcome => ({ result, status: null, finalUrl: null, softNotFound: false, offers: [], signal, blocked: false, ...extra });
  const signal = AbortSignal.timeout(timeoutMs);

  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return nothing("unknown", "bad_address");
  }
  for (let hop = 0; ; hop++) {
    if (url.protocol !== "http:" && url.protocol !== "https:") return nothing("unknown", "bad_address");
    const port = Number(url.port) || (url.protocol === "https:" ? 443 : 80);
    const verdict = await guard.check(url.hostname, port);
    if (!verdict.allowed) return verdict.reason === "private" ? nothing("unknown", "private_address", { blocked: true }) : nothing("unreachable", "not_found");
    let got: Hop;
    try {
      got = await fetchOnce(url, verdict.address, { language, maxBytes, signal });
    } catch {
      return nothing("unreachable", signal.aborted ? "timeout" : "no_answer");
    }
    if (got.location) {
      if (hop >= maxRedirects) return nothing("unknown", "too_many_redirects");
      try {
        url = new URL(got.location, url);
      } catch {
        return nothing("unknown", "bad_address");
      }
      continue;
    }
    const finalUrl = withoutQuery(url.href);
    if (got.tooLarge) return nothing("unknown", "too_large", { status: got.status, finalUrl });
    if (got.body === null) {
      if (got.status >= 500) return nothing("unreachable", "status_5xx", { status: got.status, finalUrl });
      if (got.status === 401) return nothing("login_required", "status_401", { status: got.status, finalUrl });
      if (got.status === 403 || got.status === 429) return nothing("blocked", `status_${got.status}`, { status: got.status, finalUrl });
      return nothing("unknown", "not_html", { status: got.status, finalUrl });
    }
    const facts = factsOf(got.body);
    const { result, signal: why } = explainPage({
      requestedUrl: address,
      publicPage: true,
      page: { finalUrl: url.href, status: got.status, title: facts.title, text: facts.text, hasPasswordField: facts.hasPasswordField, hasChallengeWidget: facts.hasChallengeWidget },
    });
    return {
      result,
      status: got.status,
      finalUrl,
      softNotFound: looksLikeNotFound({ title: facts.title || null, heading: null }),
      offers: offersFrom(facts.ldScripts, facts.microdata, url.href),
      signal: why,
      blocked: false,
    };
  }
}
