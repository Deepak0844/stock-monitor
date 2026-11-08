import { z } from "zod";
import type { ShopifyClient } from "./client.js";
import { isShopifyError } from "./errors.js";

const SHOP_QUERY = `query ShopName { shop { name } }`;
const SCOPES_QUERY = `query GrantedScopes { currentAppInstallation { accessScopes { handle } } }`;

const shopReply = z.object({ shop: z.object({ name: z.string() }) });
const scopesReply = z.object({
  currentAppInstallation: z.object({ accessScopes: z.array(z.object({ handle: z.string() })) }),
});

/**
 * Proves the credentials work and says what they allow. The shop's name is required, so a failure
 * there is a failure. The list of permissions is best effort: if Shopify will not say, it is null.
 */
export async function checkConnection(client: ShopifyClient): Promise<{ shopName: string; scopes: string[] | null }> {
  const shop = await client.query(SHOP_QUERY, { schema: shopReply });
  let scopes: string[] | null = null;
  try {
    const data = await client.query(SCOPES_QUERY, { schema: scopesReply });
    scopes = data.currentAppInstallation.accessScopes.map((s) => s.handle);
  } catch (error) {
    if (!(isShopifyError(error) && (error.code === "no_access" || error.code === "unexpected_reply"))) throw error;
  }
  return { shopName: shop.shop.name, scopes };
}

export type ScopeAssessment = {
  ok: boolean;
  writeScopes: string[];
  missingScopes: string[];
  warnings: string[];
};

// What the app needs to read. Shopify says a write permission also allows reading that resource.
const NEEDED = [
  { read: "read_products", write: "write_products", label: "products" },
  { read: "read_inventory", write: "write_inventory", label: "inventory" },
];

export function assessScopes(scopes: string[] | null): ScopeAssessment {
  if (scopes === null) {
    return { ok: true, writeScopes: [], missingScopes: [], warnings: ["We could not check which permissions this connection has."] };
  }
  const writeScopes = scopes.filter((s) => s.startsWith("write_") || s.startsWith("unauthenticated_write_"));
  const missing = NEEDED.filter((n) => !scopes.includes(n.read) && !scopes.includes(n.write));

  const warnings: string[] = [];
  if (writeScopes.length > 0) {
    warnings.push(
      `This connection can change your store (${writeScopes.join(", ")}). This app only needs to read, so for extra safety remove the write permissions in Shopify.`,
    );
  }
  if (missing.length > 0) {
    warnings.push(
      `This connection is missing permission to read ${missing.map((m) => m.label).join(" and ")}. Add it to the app in Shopify, then reconnect.`,
    );
  }
  return { ok: missing.length === 0, writeScopes, missingScopes: missing.map((m) => m.read), warnings };
}
