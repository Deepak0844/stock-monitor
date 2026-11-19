// Signs the app up for Shopify's change messages (webhooks), so a change in Shopify starts a sync by itself.
// This changes nothing in the store: no product, price or stock. The read-only guard test allows this file,
// besides the stock write, and checks it holds this one sign-up mutation and nothing else.
import { z } from "zod";
import type { ShopifyClient } from "./client.js";
import { ShopifyError } from "./errors.js";

/** Product created, edited (status, title, SKU, supplier fields), deleted, and stock changed at any location. */
export const WEBHOOK_TOPICS = ["PRODUCTS_CREATE", "PRODUCTS_UPDATE", "PRODUCTS_DELETE", "INVENTORY_LEVELS_UPDATE"] as const;

const LIST_QUERY = `query WebhookSubscriptions($first: Int!) {
  webhookSubscriptions(first: $first) {
    nodes { id topic uri }
  }
}`;

const CREATE_MUTATION = `mutation WebhookCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
  webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
    webhookSubscription { id }
    userErrors { field message }
  }
}`;

const listReply = z.object({
  webhookSubscriptions: z.object({ nodes: z.array(z.object({ id: z.string(), topic: z.string(), uri: z.string().nullable().optional() })) }),
});
const createReply = z.object({
  webhookSubscriptionCreate: z.object({
    webhookSubscription: z.object({ id: z.string() }).nullable(),
    userErrors: z.array(z.object({ message: z.string() })),
  }),
});

/** Makes sure each topic sends to `uri`. Creates only the missing ones, so it is safe to run on every sync. */
export async function ensureWebhookSubscriptions(client: ShopifyClient, uri: string): Promise<{ created: string[] }> {
  const data = await client.query(LIST_QUERY, { schema: listReply, variables: { first: 50 } });
  const have = new Set(data.webhookSubscriptions.nodes.filter((n) => n.uri === uri).map((n) => n.topic));
  const created: string[] = [];
  for (const topic of WEBHOOK_TOPICS) {
    if (have.has(topic)) continue;
    const reply = await client.query(CREATE_MUTATION, { schema: createReply, variables: { topic, webhookSubscription: { uri } } });
    const { userErrors } = reply.webhookSubscriptionCreate;
    if (userErrors.length > 0) throw new ShopifyError("unexpected_reply", { detail: `sign-up for ${topic} refused: ${userErrors.map((e) => e.message).join("; ")}` });
    created.push(topic);
  }
  return { created };
}
