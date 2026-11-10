// Answers the two queries used to check a connection: the shop's name and the permissions granted.
import type { GraphQLHandler } from "./fake-shopify.js";

export function withFakeShop(
  next: GraphQLHandler,
  options: { shopName?: string; scopes?: string[]; scopesDenied?: boolean } = {},
): GraphQLHandler {
  const scopes = options.scopes ?? ["read_products", "read_inventory"];
  return (request, count) => {
    if (/\bShopName\b/.test(request.query)) {
      return { body: { data: { shop: { name: options.shopName ?? "Fake Store" } } } };
    }
    if (/\bGrantedScopes\b/.test(request.query)) {
      if (options.scopesDenied) {
        return { body: { errors: [{ message: "denied", extensions: { code: "ACCESS_DENIED" } }] } };
      }
      return { body: { data: { currentAppInstallation: { accessScopes: scopes.map((handle) => ({ handle })) } } } };
    }
    return next(request, count);
  };
}
