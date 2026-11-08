import { CONTROL_URL } from "./constants.js";

async function post(path: string, body?: unknown): Promise<void> {
  const res = await fetch(`${CONTROL_URL}${path}`, {
    method: "POST",
    ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  if (!res.ok) throw new Error(`Control call ${path} failed with ${res.status}`);
}

/** Steers the fake Shopify and the stack from a test. */
export const control = {
  /** Forget the Shopify connection, its variants and sync runs, and restore the fake store's defaults. */
  reset: () => post("/control/reset"),
  /** Remove every supplier. Separate from reset so the supplier and Shopify journeys do not disturb each other. */
  resetSuppliers: () => post("/control/reset-suppliers"),
  /** Steer the stand-in browser service: whether a window opens, what a finished login holds, what a check finds. */
  browser: (behaviour: Record<string, unknown>) => post("/control/browser", behaviour),
  /** The store's owner rotates the client secret: the saved one stops working. */
  rotateSecret: (newSecret: string) => post("/control/rotate-secret", { clientSecret: newSecret }),
  /** Change which permissions the fake store reports for the app. */
  setScopes: (scopes: string[]) => post("/control/scopes", { scopes }),
  /** How many requests the fake Shopify has received so far. */
  shopifyRequestCount: async (): Promise<number> => {
    const res = await fetch(`${CONTROL_URL}/control/shopify-request-count`);
    return ((await res.json()) as { count: number }).count;
  },
};
