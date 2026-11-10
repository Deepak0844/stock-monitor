// Stock suggestions, through the real stack: the real API, worker and database, a real browser, a stand-in browser service
// that returns made-up supplier pages, and a stand-in Shopify that really accepts or refuses stock changes. No real supplier
// and no real store is touched. They reset the suppliers, variants and Shopify connection, so they run in their own
// projects, after every other journey, one after another.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { OWNER_EMAIL, OWNER_PASSWORD } from "./constants.js";
import { control } from "./control.js";

test.describe.configure({ mode: "serial" });

const SOLD_OUT = { sections: [{ heading: "Blue Tee", level: 1, lines: ["Sold out"] }], buttons: [{ label: "Add to cart", enabled: false, section: "Blue Tee" }] };
const LOGIN_PAGE = { result: "login_required", status: 200, finalUrl: null, title: null, heading: null, softNotFound: false };
const READ_ONLY = ["read_products", "read_inventory"];

test.beforeEach(async () => {
  await control.resetProposals();
});

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Email").fill(OWNER_EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(OWNER_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

const supplierId = async (page: Page) => ((await page.request.get("/api/suppliers").then((r) => r.json())) as { suppliers: { id: string }[] }).suppliers[0]!.id;

/** Checks all of Acme Supply's links now, as the Check now button does, and waits for the run to end. */
async function checkAll(page: Page) {
  const id = await supplierId(page);
  const res = await page.request.post(`/api/suppliers/${id}/check-stock`);
  expect(res.status()).toBe(202);
  await expect
    .poll(async () => ((await page.request.get(`/api/suppliers/${id}/runs/current`).then((r) => r.json())) as { run: unknown }).run, { timeout: 30_000 })
    .toBeNull();
}

/** Syncs Shopify's numbers into the app and waits for it to finish. */
async function sync(page: Page) {
  expect((await page.request.post("/api/shopify/sync")).status()).toBeLessThan(300);
  await expect
    .poll(async () => ((await page.request.get("/api/shopify/sync").then((r) => r.json())) as { lastRun: { status: string } | null }).lastRun?.status, { timeout: 30_000 })
    .toBe("succeeded");
}

const card = (page: Page, size: number) => page.getByRole("listitem", { name: `Blue Tee, Size ${size}` });
/** Opens Proposals and waits until the suggestions have been made (they are made by a background job). */
async function openProposals(page: Page, expectCount: number) {
  await expect(async () => {
    await page.goto("/proposals");
    await expect(page.getByRole("heading", { level: 1, name: "Proposals" })).toBeVisible();
    await expect(page.getByRole("listitem", { name: /Blue Tee/ })).toHaveCount(expectCount, { timeout: 1500 });
  }).toPass({ timeout: 20_000 });
}
const history = async (page: Page) => {
  await page.getByRole("button", { name: "History" }).click();
  return page.getByRole("table", { name: "Past suggestions" });
};
const scan = async (page: Page, label: string) => {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(result.violations.map((v) => `${label}: ${v.id}`), label).toEqual([]);
};

test("a sold-out supplier makes suggestions to set 0; one press on Approve changes Shopify and the result is in History", async ({ page }) => {
  await signIn(page);
  await control.browser({ description: SOLD_OUT });
  await checkAll(page);
  await openProposals(page, 3);

  const first = card(page, 1);
  await expect(first).toContainText("Acme Supply said Out of stock");
  await expect(first).toContainText("Shopify shows 4");
  await expect(first).toContainText("Suggested: set to 0");
  expect((await control.shopifyStock(1)).quantity).toBe(4); // nothing changes until Approve

  await first.getByRole("button", { name: /^Approve/ }).click();
  await expect(card(page, 1)).toHaveCount(0, { timeout: 20_000 }); // waits for Shopify, then it is done
  await expect(card(page, 2)).toBeVisible(); // the others were not touched
  expect(await control.shopifyStock(1)).toEqual({ quantity: 0, writes: 1 });
  expect((await control.shopifyStock(2)).quantity).toBe(4);

  const table = await history(page);
  await expect(table.getByRole("row", { name: /Size 1/ })).toContainText("Applied");
  await expect(table.getByRole("row", { name: /Size 1/ })).toContainText("Shopify now shows 0.");
});

test("a supplier back in stock where Shopify shows 0 suggests the default quantity, and an edited number is what is written", async ({ page }) => {
  await signIn(page);
  await control.setShopifyStock(2, 0);
  await sync(page);
  await checkAll(page); // the stand-in supplier page is in stock
  await openProposals(page, 1);
  const item = card(page, 2);
  await expect(item).toContainText("Back in stock");
  await expect(item).toContainText("Suggested: set to 5");

  await item.getByRole("button", { name: /Edit number/ }).click();
  await item.getByLabel("New number").fill("7");
  await item.getByRole("button", { name: /^Approve/ }).click();
  await expect(card(page, 2)).toHaveCount(0, { timeout: 20_000 });
  expect((await control.shopifyStock(2)).quantity).toBe(7);
  const table = await history(page);
  await expect(table.getByRole("row", { name: /Size 2/ })).toContainText("Set to 7 (edited)");
});

test("if Shopify's number changed after the suggestion, Approve writes nothing and says so", async ({ page }) => {
  await signIn(page);
  await control.browser({ description: SOLD_OUT });
  await checkAll(page);
  await openProposals(page, 3);
  await control.setShopifyStock(1, 3); // a sale, behind the app's back
  await card(page, 1).getByRole("button", { name: /^Approve/ }).click();
  await expect(card(page, 1)).toHaveCount(0, { timeout: 20_000 });
  expect(await control.shopifyStock(1)).toEqual({ quantity: 3, writes: 0 });
  const table = await history(page);
  await expect(table.getByRole("row", { name: /Size 1/ })).toContainText("Not applied: Shopify changed");
  await expect(table.getByRole("row", { name: /Size 1/ })).toContainText("Shopify now shows 3, so nothing was changed.");

  // The Dashboard says a change was not applied, and the Links page says what became of the link's suggestion.
  await page.goto("/");
  await expect(page.getByText(/A stock change was not applied because Shopify's number changed/)).toBeVisible();
  await expect(page.getByRole("link", { name: "See proposals" })).toHaveAttribute("href", "/proposals");
  await page.goto("/mappings");
  await expect(page.getByRole("row", { name: /Size 1/ })).toContainText("Suggestion: Out of stock, not applied: Shopify changed");
  await page.goto("/proposals");
  await page.getByRole("button", { name: "History" }).click();

  // Refresh reads Shopify again and makes a new suggestion from the number it shows now. Nothing was overwritten.
  await table.getByRole("button", { name: "Refresh Blue Tee, Size 1" }).click();
  await expect(page.getByText(/Reading Shopify again/)).toBeVisible();
  await expect(async () => {
    await page.goto("/proposals");
    await expect(card(page, 1)).toContainText("Shopify shows 3", { timeout: 1500 });
  }).toPass({ timeout: 20_000 });
  await expect(card(page, 1)).toContainText("Suggested: set to 0");
  expect(await control.shopifyStock(1)).toEqual({ quantity: 3, writes: 0 });
  await page.goto("/");
  await expect(page.getByText(/A stock change was not applied/)).toHaveCount(0); // refreshing closed the notice
});

test("Reject needs no reason, changes nothing in Shopify, and the same answer does not come back", async ({ page }) => {
  await signIn(page);
  await control.browser({ description: SOLD_OUT });
  await checkAll(page);
  await openProposals(page, 3);
  await card(page, 3).getByRole("button", { name: /^Reject/ }).click();
  await expect(card(page, 3)).toHaveCount(0);
  expect(await control.shopifyStock(3)).toEqual({ quantity: 4, writes: 0 });
  await sync(page); // a sync asks for the suggestions again; the rejected one must not return
  await page.waitForTimeout(1500);
  await openProposals(page, 2);
  const table = await history(page);
  await expect(table.getByRole("row", { name: /Size 3/ })).toContainText("Rejected");
});

test("suggestions that nobody decided expire, and cannot be approved", async ({ page }) => {
  await signIn(page);
  await control.browser({ description: SOLD_OUT });
  await checkAll(page);
  await openProposals(page, 3);
  await control.tick(25 * 60); // 25 hours later
  await page.goto("/proposals");
  await expect(page.getByText(/Nothing is waiting for you/)).toBeVisible();
  const table = await history(page);
  await expect(table.getByRole("row", { name: /Size 1/ })).toContainText("Expired");
  expect((await control.shopifyStock(1)).writes).toBe(0);
});

test("without permission to change stock, Approve is off and says why, and nothing is sent", async ({ page }) => {
  await control.resetProposals(READ_ONLY);
  await signIn(page);
  await control.browser({ description: SOLD_OUT });
  await checkAll(page);
  await openProposals(page, 3);
  await expect(page.getByText("Shopify has not given this app permission to change stock yet.")).toBeVisible();
  await expect(card(page, 1).getByRole("button", { name: /^Approve/ })).toBeDisabled();
  // Even a direct request is refused.
  const list = (await page.request.get("/api/proposals").then((r) => r.json())) as { proposals: { id: string }[] };
  const res = await page.request.post(`/api/proposals/${list.proposals[0]!.id}/approve`, { data: {} });
  expect(res.status()).toBe(409);
  expect((await control.shopifyStock(1)).writes).toBe(0);
});

test("a check that could not tell shows no suggestion", async ({ page }) => {
  await signIn(page);
  await control.browser({ page: LOGIN_PAGE });
  await checkAll(page);
  await page.goto("/proposals");
  await expect(page.getByText(/Nothing is waiting for you/)).toBeVisible();
  await expect(page.getByRole("listitem", { name: /Blue Tee/ })).toHaveCount(0);
});

test("the settings change the back-in-stock number, and they are still there after a reload", async ({ page }) => {
  await signIn(page);
  await page.goto("/settings/shopify");
  await page.getByLabel("Quantity for back-in-stock suggestions").fill("9");
  await page.getByLabel("Hours a suggestion stays open").fill("12");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Quantity for back-in-stock suggestions")).toHaveValue("9");
  await expect(page.getByLabel("Hours a suggestion stays open")).toHaveValue("12");
  await expect(page.getByText("Shopify allows this app to change stock.")).toBeVisible();

  await control.setShopifyStock(1, 0);
  await sync(page);
  await checkAll(page);
  await openProposals(page, 1);
  await expect(card(page, 1)).toContainText("Suggested: set to 9");
});

test("the Proposals screens pass the accessibility scan in light and dark and do not scroll sideways", async ({ page }) => {
  await signIn(page);
  await control.browser({ description: SOLD_OUT });
  await checkAll(page);
  await openProposals(page, 3);
  await card(page, 3).getByRole("button", { name: /^Reject/ }).click();
  await expect(card(page, 3)).toHaveCount(0);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/proposals");
    await expect(card(page, 1)).toBeVisible();
    await scan(page, `proposals ${scheme}`);
    await card(page, 1).getByRole("button", { name: /Edit number/ }).click();
    await scan(page, `proposals editing ${scheme}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), "waiting list scrolls sideways").toBe(false);
    await history(page);
    await scan(page, `history ${scheme}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), "history scrolls sideways").toBe(false);
    await page.goto("/settings/shopify");
    await expect(page.getByLabel("Quantity for back-in-stock suggestions")).toBeVisible();
    await scan(page, `settings ${scheme}`);
  }
});
