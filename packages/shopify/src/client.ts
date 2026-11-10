import type { z } from "zod";
import { resolveBaseUrl, type BaseUrlResolver } from "./base-url.js";
import { ShopifyError, type ShopifyErrorCode } from "./errors.js";
import { createThrottleTracker, type ThrottleStatus } from "./throttle.js";
import type { TokenProvider } from "./token-provider.js";
import { SHOPIFY_API_VERSION } from "./version.js";

export type QueryOptions<T> = {
  /** Every reply is checked against this. Anything that does not match is refused, never half used. */
  schema: z.ZodType<T>;
  variables?: Record<string, unknown>;
  /** The query's expected cost in points. Defaults to what the previous query cost. */
  estimatedCost?: number;
};

export type ShopifyClient = {
  query<T>(query: string, options: QueryOptions<T>): Promise<T>;
  /** The cost bucket Shopify last reported. */
  throttleStatus(): ThrottleStatus | null;
};

export type ShopifyClientOptions = {
  shop: string;
  tokens: TokenProvider;
  baseUrl?: BaseUrlResolver;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  /** Total tries for one query when Shopify is busy or briefly failing. Default 4. */
  maxAttempts?: number;
};

const BACKOFF_START_MS = 1000;
const BACKOFF_MAX_MS = 8000;

type Failure =
  | { kind: "fatal"; error: ShopifyError }
  | { kind: "retry"; code: Extract<ShopifyErrorCode, "throttled" | "unreachable"> }
  | { kind: "renew_token" };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const fatal = (code: ShopifyErrorCode, detail?: string): Failure => ({
  kind: "fatal",
  error: new ShopifyError(code, detail ? { detail } : undefined),
});

/** What an HTTP status alone tells us. Returns null when the status is fine. */
function failureForStatus(status: number): Failure | null {
  if (status >= 200 && status < 300) return null;
  if (status === 401) return { kind: "renew_token" };
  if (status === 402 || status === 403 || status === 423) return fatal("store_unavailable");
  if (status === 429) return { kind: "retry", code: "throttled" };
  if (status >= 500) return { kind: "retry", code: "unreachable" };
  return fatal("unexpected_reply", `status ${status}`); // 404, 400 and anything else
}

/** Shopify mostly reports problems as HTTP 200 with an errors list, so the codes matter more than the status. */
function failureForErrors(errors: unknown): Failure {
  const codes = Array.isArray(errors)
    ? errors.map((e) => (isObject(e) && isObject(e.extensions) ? e.extensions.code : undefined))
    : [];
  if (codes.includes("THROTTLED")) return { kind: "retry", code: "throttled" };
  if (codes.includes("INTERNAL_SERVER_ERROR")) return { kind: "retry", code: "unreachable" };
  if (codes.includes("ACCESS_DENIED")) return fatal("no_access");
  if (codes.includes("SHOP_INACTIVE")) return fatal("store_unavailable");
  // MAX_COST_EXCEEDED means our own query is too expensive, which is a bug to fix, not to retry.
  return fatal("unexpected_reply", "errors in reply");
}

export function createShopifyClient(options: ShopifyClientOptions): ShopifyClient {
  const url = `${resolveBaseUrl(options.shop, options.baseUrl)}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxAttempts = options.maxAttempts ?? 4;

  const tracker = createThrottleTracker(now);
  let lastRequestedCost = 0;

  function learnFromCost(body: Record<string, unknown>) {
    const cost = isObject(body.extensions) && isObject(body.extensions.cost) ? body.extensions.cost : undefined;
    if (!cost) return;
    tracker.update(cost.throttleStatus);
    if (typeof cost.requestedQueryCost === "number" && Number.isFinite(cost.requestedQueryCost)) {
      lastRequestedCost = cost.requestedQueryCost;
    }
  }

  async function attemptOnce<T>(query: string, opts: QueryOptions<T>): Promise<{ value: T } | { failure: Failure }> {
    const token = await options.tokens.getToken();
    let response: Response;
    try {
      response = await doFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-shopify-access-token": token },
        body: JSON.stringify({ query, ...(opts.variables ? { variables: opts.variables } : {}) }),
        // Never follow a redirect: the access token must not be sent to any other host.
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return { failure: { kind: "retry", code: "unreachable" } };
    }

    const statusFailure = failureForStatus(response.status);
    if (statusFailure) return { failure: statusFailure };

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { failure: fatal("unexpected_reply", "reply was not JSON") };
    }
    if (!isObject(body)) return { failure: fatal("unexpected_reply", "reply was not an object") };

    learnFromCost(body);
    if (body.errors !== undefined) return { failure: failureForErrors(body.errors) };

    const parsed = opts.schema.safeParse(body.data);
    if (!parsed.success) return { failure: fatal("unexpected_reply", "data did not match the expected shape") };
    return { value: parsed.data };
  }

  return {
    async query<T>(query: string, opts: QueryOptions<T>): Promise<T> {
      const estimate = () => opts.estimatedCost ?? lastRequestedCost;
      let tries = 0;
      let renewedToken = false;
      let alreadyWaited = false;

      for (;;) {
        const wait = alreadyWaited ? 0 : tracker.waitMs(estimate());
        alreadyWaited = false;
        if (wait > 0) await sleep(wait);

        const result = await attemptOnce(query, opts);
        if ("value" in result) return result.value;

        const { failure } = result;
        if (failure.kind === "fatal") throw failure.error;

        if (failure.kind === "renew_token") {
          if (renewedToken) throw new ShopifyError("rejected_credentials");
          renewedToken = true;
          options.tokens.invalidate();
          continue;
        }

        tries += 1;
        if (tries >= maxAttempts) throw new ShopifyError(failure.code);
        const backoff = Math.min(BACKOFF_MAX_MS, BACKOFF_START_MS * 2 ** (tries - 1));
        // Wait for whichever is longer: the backoff, or the time the cost bucket needs to refill.
        await sleep(Math.max(backoff, tracker.waitMs(estimate())));
        alreadyWaited = true;
      }
    },

    throttleStatus: () => tracker.last(),
  };
}
