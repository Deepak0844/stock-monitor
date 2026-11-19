import { verifyShopifyHmac } from "@stock-monitor/shopify";
import type { App, ShopifyRoutesDeps } from "./shopify.js";

/** Must match the worker's grouping, so every change in a minute folds into one sync. */
const SYNC_GROUP_SECONDS = 60;
// A product with many variants sends a big body. Shopify's own messages stay well under this.
const BODY_LIMIT = 5 * 1024 * 1024;

export const SHOPIFY_WEBHOOK_PATH = "/api/shopify/webhooks";

/**
 * Shopify's change messages. Public (Shopify has no login), so every message must be signed with the saved client
 * secret and come from the saved shop. The body is only checked, never used: any change starts the normal full sync.
 */
export function registerShopifyWebhookRoutes(app: App, deps: Pick<ShopifyRoutesDeps, "repo" | "queue">): void {
  // Its own scope, so only this route keeps the raw body (the signature is over the exact bytes).
  app.register(async (scope) => {
    scope.addContentTypeParser("application/json", { parseAs: "buffer", bodyLimit: BODY_LIMIT }, (_req, body, done) => done(null, body));

    scope.post(SHOPIFY_WEBHOOK_PATH, { bodyLimit: BODY_LIMIT }, async (request, reply) => {
      const refuse = (why: string) => {
        request.log.warn({ why, topic: request.headers["x-shopify-topic"] }, "Shopify change message refused");
        return reply.status(401).send({ error: { code: "unauthenticated", message: "Not a valid Shopify message.", requestId: request.id } });
      };
      const saved = await deps.repo.getCredentials();
      if (!saved || saved.credentials.type !== "client_credentials") return refuse("no client ID + secret connection");
      if (request.headers["x-shopify-shop-domain"] !== saved.shop) return refuse("another shop");
      const raw = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
      const header = request.headers["x-shopify-hmac-sha256"];
      if (!verifyShopifyHmac(raw, typeof header === "string" ? header : undefined, saved.credentials.clientSecret)) return refuse("bad signature");
      await deps.queue.enqueue("shopify.sync", {}, { groupSeconds: SYNC_GROUP_SECONDS });
      return { ok: true };
    });
  });
}
