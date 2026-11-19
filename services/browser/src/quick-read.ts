import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { pipeline } from "node:stream";
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

const MAX_TAG = 4000;
const RAW_TEXT = new Set(["script", "style", "noscript", "template"]);

/**
 * What the classifier needs from the HTML, in ONE pass from left to right: every step moves forward, so the work is linear
 * in the size of the page whatever it holds (no pattern ever scans the rest of the page from each "<"). Patterns run only on
 * one tag at a time, cut to 4000 characters. Never kept or returned.
 */
function factsOf(htmlText: string) {
  const lower = htmlText.toLowerCase();
  const textParts: string[] = [];
  let textLength = 0;
  let title = "";
  let hasPasswordField = false;
  let hasChallengeWidget = false;
  const ldScripts: string[] = [];
  let scriptChars = 0;
  const microdata: string[] = [];
  const addText = (from: number, to: number) => {
    if (to > from && textLength < MAX_TEXT) {
      const part = htmlText.slice(from, Math.min(to, from + MAX_TEXT));
      textParts.push(part);
      textLength += part.length;
    }
  };

  let pos = 0;
  while (pos < htmlText.length) {
    const open = htmlText.indexOf("<", pos);
    if (open === -1) {
      addText(pos, htmlText.length);
      break;
    }
    addText(pos, open);
    const close = htmlText.indexOf(">", open + 1);
    if (close === -1) break; // an unclosed tag runs to the end: nothing more to read
    const tag = htmlText.slice(open, Math.min(close + 1, open + MAX_TAG));
    const name = /^<\/?\s*([a-z][a-z0-9-]*)/i.exec(tag)?.[1]?.toLowerCase() ?? "";
    pos = close + 1;
    if (name === "input" && /\btype\s*=\s*["']?password\b/i.test(tag) && !/\bhidden\b/i.test(tag.replace(/\btype\s*=\s*["']?password["']?/i, ""))) hasPasswordField = true;
    if (/class\s*=\s*["'][^"']*\b(?:h-captcha|g-recaptcha|cf-turnstile)\b/i.test(tag) || (name === "iframe" && /hcaptcha\.com|google\.com\/recaptcha|challenges\.cloudflare\.com/i.test(tag))) hasChallengeWidget = true;
    if (/\bitemprop\s*=\s*["']?availability\b/i.test(tag) && microdata.length < MAX_MICRODATA) {
      const value = /\b(?:href|content)\s*=\s*["']([^"']{1,200})["']/i.exec(tag)?.[1];
      if (value) microdata.push(value);
    }
    if (tag.startsWith("</") || (!RAW_TEXT.has(name) && name !== "title")) continue;
    // A tag whose content is raw text: jump straight to its closing tag.
    const end = lower.indexOf(`</${name}`, pos);
    if (end === -1) break;
    const body = htmlText.slice(pos, end);
    if (name === "title" && !title) title = body.slice(0, 2000);
    if (name === "script" && /\btype\s*=\s*["']?application\/ld\+json/i.test(tag) && body.length <= MAX_SCRIPT && scriptChars + body.length <= MAX_SCRIPTS) {
      ldScripts.push(body);
      scriptChars += body.length;
    }
    if (name === "title") addText(pos, end);
    pos = end;
  }
  const text = oneLine(decode(textParts.join(" "))).slice(0, MAX_TEXT);
  return { title: oneLine(decode(title)), text, hasPasswordField, hasChallengeWidget, ldScripts, microdata };
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
        let settled = false;
        const settle = (hop: Hop) => {
          if (settled) return;
          settled = true;
          resolve(hop);
        };
        const fail = (error: Error) => {
          if (settled) return;
          settled = true;
          reject(error);
        };
        if (location || !/text\/html|application\/xhtml/i.test(contentType)) {
          // The body is not wanted: stop the download now, not when the time runs out.
          settle({ status, location, contentType, body: null, tooLarge: false });
          req.destroy();
          return;
        }
        const encoding = String(res.headers["content-encoding"] ?? "").toLowerCase();
        const decoder = encoding === "gzip" ? createGunzip() : encoding === "br" ? createBrotliDecompress() : encoding === "deflate" ? createInflate() : null;
        const chunks: Buffer[] = [];
        let size = 0;
        const onData = (chunk: Buffer) => {
          size += chunk.length; // counted after decompressing, so a small bomb cannot grow past the limit
          if (size > options.maxBytes) {
            settle({ status, location: null, contentType, body: null, tooLarge: true });
            req.destroy();
            decoder?.destroy();
            return;
          }
          chunks.push(chunk);
        };
        const onEnd = () => settle({ status, location: null, contentType, body: Buffer.concat(chunks).toString("utf8"), tooLarge: false });
        if (decoder) {
          // pipeline passes a stalled, cut or broken response on to the decoder, so the read always ends.
          decoder.on("data", onData);
          pipeline(res, decoder, (error) => (error ? fail(error) : onEnd()));
        } else {
          res.on("data", onData);
          res.on("end", onEnd);
          res.on("error", fail);
          res.on("close", () => (res.complete ? onEnd() : fail(new Error("response cut"))));
        }
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
