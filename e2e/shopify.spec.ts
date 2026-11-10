// The Shopify journeys, through the real stack: the real API, database, job queue and worker handler,
// with a fake Shopify. They share one Shopify connection, so they run one after another.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { COUNTS } from "./catalog.js";
import { CLIENT_ID, CLIENT_SECRET, OWNER_EMAIL, OWNER_PASSWORD, ROTATED_SECRET, SHOP, SHOP_NAME } from "./constants.js";
import { control } from "./control.js";

test.describe.configure({ mode: "serial" });
test.setTimeout(90_000);

test.beforeEach(async () => {
  await control.reset();
});

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Email").fill(OWNER_EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(OWNER_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

/** On a phone the navigation sits behind the Menu button. */
async function goTo(page: Page, link: "Products" | "Settings") {
  const menu = page.getByRole("button", { name: "Menu" });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: link }).click();
}

async function fillConnectForm(page: Page, secret = CLIENT_SECRET, shop = SHOP) {
  await page.getByLabel("Store address").fill(shop);
  await page.getByLabel("Client ID").fill(CLIENT_ID);
  await page.getByLabel("Client secret").fill(secret);
}

async function connect(page: Page) {
  await fillConnectForm(page);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByText(`Connected to ${SHOP_NAME}.`)).toBeVisible();
}

async function chooseShopFloor(page: Page) {
  await page.getByLabel("Location", { exact: true }).selectOption({ label: "Shop floor" });
  await expect(page.getByText("Using Shop floor.")).toBeVisible();
}

async function syncAndWait(page: Page) {
  await page.getByRole("button", { name: "Sync from Shopify" }).click();
  await expect(page.getByText(/Last sync finished/)).toBeVisible({ timeout: 45_000 });
}

/** Opens settings, connects, picks the location and syncs. */
async function connectedAndSynced(page: Page) {
  await signIn(page);
  await page.goto("/settings/shopify");
  await connect(page);
  await chooseShopFloor(page);
  await syncAndWait(page);
}

test("connect, test, choose a location, sync, and see the products", async ({ page }) => {
  await signIn(page);
  await goTo(page, "Settings");
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();

  await fillConnectForm(page);
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByText(`Connection works. Store name: ${SHOP_NAME}.`)).toBeVisible();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByText(`Connected to ${SHOP_NAME}.`)).toBeVisible();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await expect(page.getByText("read_products")).toBeVisible();
  await expect(page.getByLabel("Client secret")).toHaveCount(0);

  // Sync is not offered until a location is chosen.
  await expect(page.getByRole("button", { name: "Sync from Shopify" })).toBeDisabled();
  await expect(page.getByText("Choose an inventory location first.")).toBeVisible();
  await chooseShopFloor(page);

  await page.getByRole("button", { name: "Sync from Shopify" }).click();
  await expect(page.getByRole("button", { name: "Syncing…" })).toBeVisible();
  await expect(page.getByText(/Last sync finished/)).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText(new RegExp(`${COUNTS.total} variants`))).toBeVisible();
  await expect(page.getByText(new RegExp(`${COUNTS.total} new`))).toBeVisible();

  await goTo(page, "Products");
  await expect(page.getByRole("heading", { level: 1, name: "Products" })).toBeVisible();
  await expect(page.getByText("Stock shown is available at Shop floor.")).toBeVisible();
  await expect(page.getByRole("table", { name: "Products from Shopify" })).toBeVisible();
  await expect(page.getByText(`Showing 1 to ${COUNTS.pageSize} of ${COUNTS.total} variants`)).toBeVisible();
  await expect(page.getByRole("row")).toHaveCount(COUNTS.pageSize + 1);

  // Paging, search, the attention filter, and the honest cases.
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByText(`Page 2 of ${Math.ceil(COUNTS.total / COUNTS.pageSize)}`)).toBeVisible();
  await page.getByRole("button", { name: "Previous page" }).click();

  await page.getByRole("searchbox", { name: "Search products" }).fill("SKU-0011");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("Not stocked here")).toBeVisible();

  await page.getByRole("searchbox", { name: "Search products" }).fill("SKU-0005");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("Only variant")).toBeVisible();

  await page.getByRole("button", { name: "Clear search" }).or(page.getByRole("searchbox", { name: "Search products" })).first().waitFor();
  await page.getByRole("searchbox", { name: "Search products" }).fill("hose");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText(`Showing 1 to ${COUNTS.hose} of ${COUNTS.hose} variants`)).toBeVisible();

  await page.getByRole("searchbox", { name: "Search products" }).fill("");
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("checkbox", { name: "Show only items that need attention" }).check();
  await expect(page.getByText(`Showing 1 to ${COUNTS.needsAttention} of ${COUNTS.needsAttention} variants`)).toBeVisible();
  await expect(page.getByText("This item keeps selling at 0.").first()).toBeVisible();
  await expect(page.getByText(/Shopify is not tracking stock for this item/).first()).toBeVisible();
});

test("wrong credentials are refused in plain words and nothing is saved", async ({ page }) => {
  await signIn(page);
  await page.goto("/settings/shopify");
  await fillConnectForm(page, "not-the-secret");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Shopify rejected the saved connection. Reconnect Shopify.");
  await expect(page.getByRole("heading", { name: "Connect your Shopify store" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Connect your Shopify store" })).toBeVisible();
});

test("a bad store address is refused beside its field, before Shopify is contacted", async ({ page }) => {
  await signIn(page);
  await page.goto("/settings/shopify");
  const before = await control.shopifyRequestCount();
  await fillConnectForm(page, CLIENT_SECRET, "evil.com");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByText("Enter your store address, like my-store.myshopify.com.", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Store address")).toHaveAttribute("aria-invalid", "true");
  expect(await control.shopifyRequestCount()).toBe(before);
});

test("a connection that stops working asks for a reconnect, and reconnecting restores sync", async ({ page }) => {
  await connectedAndSynced(page);

  await control.rotateSecret(ROTATED_SECRET); // the store owner changes the secret
  await page.getByRole("button", { name: "Sync from Shopify" }).click();
  await expect(page.getByText("Needs reconnecting")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole("alert").first()).toHaveText("Shopify rejected the saved connection. Reconnect Shopify.");
  await expect(page.getByRole("button", { name: "Sync from Shopify" })).toBeDisabled();
  await expect(page.getByText("Reconnect Shopify first.")).toBeVisible();

  await page.getByRole("button", { name: "Reconnect Shopify" }).click();
  await expect(page.getByLabel("Store address")).toHaveValue(SHOP);
  await expect(page.getByLabel("Client secret")).toHaveValue("");
  await page.getByLabel("Client ID").fill(CLIENT_ID);
  await page.getByLabel("Client secret").fill(ROTATED_SECRET);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();

  await syncAndWait(page);
  await expect(page.getByText(new RegExp(`${COUNTS.total} unchanged`))).toBeVisible();
});

test("disconnecting asks first, and then returns to the connect form", async ({ page }) => {
  await signIn(page);
  await page.goto("/settings/shopify");
  await connect(page);

  await page.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByText(/the saved credentials will be deleted/i)).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Disconnect" }).click();
  await page.getByRole("button", { name: "Yes, disconnect" }).click();
  await expect(page.getByRole("heading", { name: "Connect your Shopify store" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Connect your Shopify store" })).toBeVisible();
});

test("a connection that can change the store is flagged in plain words", async ({ page }) => {
  await control.setScopes(["read_products", "read_inventory", "write_inventory"]);
  await signIn(page);
  await page.goto("/settings/shopify");
  await fillConnectForm(page);
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByText(/This connection can change stock numbers \(write_inventory\)/)).toBeVisible();
});

test("the products page asks the owner to connect, then to sync", async ({ page }) => {
  await signIn(page);
  await page.goto("/products");
  await expect(page.getByText("No products yet. Connect Shopify in Settings.")).toBeVisible();
  await page.getByRole("link", { name: "Go to Shopify settings" }).click();
  await connect(page);
  await page.goto("/products");
  await expect(page.getByText("No products have been imported yet. Sync from Shopify in Settings.")).toBeVisible();
});

test("no secret appears in any page, response, console message or browser storage", async ({ page, context }) => {
  const responses: string[] = [];
  const consoleText: string[] = [];
  page.on("console", (m) => consoleText.push(m.text()));
  page.on("pageerror", (e) => consoleText.push(e.message));
  page.on("response", async (r) => {
    if (!r.url().includes("/api/")) return;
    try {
      responses.push(await r.text());
    } catch {
      // A response that was cut off has nothing to check.
    }
  });

  await connectedAndSynced(page);
  await page.getByRole("button", { name: "Test connection" }).click();
  await expect(page.getByText(`Connection works. Store name: ${SHOP_NAME}.`)).toBeVisible();
  await page.goto("/products");
  await expect(page.getByRole("table", { name: "Products from Shopify" })).toBeVisible();
  await page.goto("/settings/shopify");
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();

  const secrets = [CLIENT_SECRET, CLIENT_ID, ROTATED_SECRET, "fake-access-token"];
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  const everything = [...responses, ...consoleText, await page.content(), storage].join("\n");
  for (const secret of secrets) expect(everything, `"${secret}" must not appear`).not.toContain(secret);

  // The only cookie is the session, and the page's scripts cannot read it.
  const cookies = await (context as BrowserContext).cookies();
  expect(cookies.length).toBeGreaterThan(0);
  expect(cookies.every((c) => c.httpOnly)).toBe(true);
});

test("every Shopify screen passes the accessibility scan in light and dark", async ({ page }) => {
  const scan = async (label: string) => {
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(result.violations.map((v) => `${label}: ${v.id}`), label).toEqual([]);
  };

  await signIn(page);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await control.reset();
    await page.goto("/settings/shopify");
    await expect(page.getByRole("heading", { name: "Connect your Shopify store" })).toBeVisible();
    await scan(`${scheme} settings, not connected`);
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(page.getByText("Enter the client secret.")).toBeVisible();
    await scan(`${scheme} settings, with messages`);

    await page.goto("/products");
    await expect(page.getByText("No products yet. Connect Shopify in Settings.")).toBeVisible();
    await scan(`${scheme} products, empty`);

    await page.goto("/settings/shopify");
    await connect(page);
    await chooseShopFloor(page);
    await scan(`${scheme} settings, connected`);
    await syncAndWait(page);
    await scan(`${scheme} settings, synced`);

    await page.goto("/products");
    await expect(page.getByRole("table", { name: "Products from Shopify" })).toBeVisible();
    await scan(`${scheme} products, list`);
  }
});

test("the Shopify screens do not scroll sideways", async ({ page }) => {
  await connectedAndSynced(page);
  for (const path of ["/settings/shopify", "/products"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${path} overflows`).toBeLessThanOrEqual(0);
  }
});
