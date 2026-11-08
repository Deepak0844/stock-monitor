import { z } from "zod";
import { resolveBaseUrl, type BaseUrlResolver } from "./base-url.js";
import { ShopifyError, type ShopifyErrorCode } from "./errors.js";

export type Credentials =
  | { type: "client_credentials"; clientId: string; clientSecret: string }
  | { type: "static_token"; accessToken: string };

export type TokenProvider = {
  /** A valid access token. Fetches or refreshes one when needed. */
  getToken(): Promise<string>;
  /** Forget the current token, for example after Shopify rejects it. The next call gets a new one. */
  invalidate(): void;
};

export type TokenProviderOptions = {
  shop: string;
  credentials: Credentials;
  baseUrl?: BaseUrlResolver;
  fetch?: typeof fetch;
  now?: () => number;
  /** How long before expiry to renew. Default 10 minutes. */
  refreshAheadMs?: number;
  timeoutMs?: number;
};

// Shopify's documented reply for the client credentials grant.
const tokenReply = z.object({
  access_token: z.string().min(1),
  scope: z.string().optional(),
  expires_in: z.number().positive().finite(),
});

const MINUTE = 60_000;
const RETRY_AFTER_FAILED_REFRESH_MS = 30_000;

// Nothing from Shopify's reply text is ever copied into an error, so no secret can leak that way.
function errorFor(status: number, body: string): ShopifyError {
  if (body.includes("shop_not_permitted")) return new ShopifyError("wrong_organization");
  if (status === 400 || status === 401 || status === 403) return new ShopifyError("rejected_credentials");
  if (status === 429) return new ShopifyError("throttled");
  if (status >= 500) return new ShopifyError("unreachable");
  return new ShopifyError("unexpected_reply");
}

const KEEP_OLD_TOKEN_FOR: ShopifyErrorCode[] = ["unreachable", "throttled", "unexpected_reply"];

export function createTokenProvider(options: TokenProviderOptions): TokenProvider {
  const baseUrl = resolveBaseUrl(options.shop, options.baseUrl);
  const { credentials } = options;

  if (credentials.type === "static_token") {
    if (!credentials.accessToken) throw new Error("The access token must not be empty.");
    return { getToken: async () => credentials.accessToken, invalidate: () => {} };
  }
  if (!credentials.clientId || !credentials.clientSecret) {
    throw new Error("The client ID and client secret must not be empty.");
  }

  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const refreshAheadMs = options.refreshAheadMs ?? 10 * MINUTE;
  const timeoutMs = options.timeoutMs ?? 10_000;

  let cached: { token: string; expiresAt: number; refreshAt: number } | null = null;
  let inflight: Promise<string> | null = null;

  async function requestToken(): Promise<{ token: string; expiresInMs: number }> {
    let response: Response;
    try {
      response = await doFetch(`${baseUrl}/admin/oauth/access_token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: credentials.type === "client_credentials" ? credentials.clientId : "",
          client_secret: credentials.type === "client_credentials" ? credentials.clientSecret : "",
        }).toString(),
        // Never follow a redirect: a POST redirect could carry the credentials to another host.
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new ShopifyError("unreachable");
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw errorFor(response.status, body);
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new ShopifyError("unexpected_reply", { detail: "reply was not JSON" });
    }
    const parsed = tokenReply.safeParse(json);
    if (!parsed.success) throw new ShopifyError("unexpected_reply", { detail: "reply had missing or invalid fields" });
    return { token: parsed.data.access_token, expiresInMs: parsed.data.expires_in * 1000 };
  }

  async function refresh(): Promise<string> {
    try {
      const { token, expiresInMs } = await requestToken();
      const t = now();
      // Renew ahead of expiry, but never so early that a short-lived token is renewed on every call.
      const ahead = Math.min(refreshAheadMs, expiresInMs / 2);
      cached = { token, expiresAt: t + expiresInMs, refreshAt: t + expiresInMs - ahead };
      return token;
    } catch (error) {
      const code = error instanceof ShopifyError ? error.code : undefined;
      if (cached && code && KEEP_OLD_TOKEN_FOR.includes(code) && now() < cached.expiresAt) {
        // The current token still works. Keep using it, and wait a little before trying again.
        cached.refreshAt = now() + RETRY_AFTER_FAILED_REFRESH_MS;
        return cached.token;
      }
      cached = null;
      throw error;
    }
  }

  return {
    async getToken() {
      if (cached && now() < cached.refreshAt) return cached.token;
      inflight ??= refresh().finally(() => {
        inflight = null;
      });
      return inflight;
    },
    invalidate() {
      cached = null;
    },
  };
}
