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
  /** A clean slate for the link journeys: variants, one connected supplier with no recorded permission, no links. */
  resetMappings: () => post("/control/reset-mappings"),
  /** A clean slate for the stock rule journeys: six linked variants, one connected supplier that is allowed, no rules. */
  resetExtraction: () => post("/control/reset-extraction"),
  /** Turns a set of stock rules on directly, for a journey that is about checking, not about building rules. */
  seedRecipe: (rules: unknown) => post("/control/seed-recipe", { rules }),
  /** One pass of the scheduler, as if this many minutes had gone by. Returns which suppliers it started and which it skipped. */
  tick: async (advanceMinutes = 0): Promise<{ started: string[]; skipped: { supplierId: string; reason: string }[] }> => {
    const res = await fetch(`${CONTROL_URL}/control/tick`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ advanceMinutes }) });
    if (!res.ok) throw new Error(`Control call /control/tick failed with ${res.status}`);
    return (await res.json()) as { started: string[]; skipped: { supplierId: string; reason: string }[] };
  },
  /** Turns the stand-in VNC screen off or on, to test a screen the proxy cannot reach. */
  vnc: (available: boolean) => post("/control/vnc", { available }),
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
