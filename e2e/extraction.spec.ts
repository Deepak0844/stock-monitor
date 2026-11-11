// The stock rule screens, through the real stack: the real API, worker and database, a real browser, a stand-in browser
// service that returns made-up pages, and no real supplier. They reset the suppliers and the variants, so they run in their
// own projects, after every other journey, and one after another.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { OWNER_EMAIL, OWNER_PASSWORD } from "./constants.js";
import { control } from "./control.js";
import { expectSignedIn, rowMenu, settle } from "./ui.js";

test.describe.configure({ mode: "serial" });

test.beforeEach(async () => {
  await control.resetExtraction();
});

const inStock = { sections: [{ heading: "Blue Tee", level: 1, lines: ["Soft cotton."] }], buttons: [{ label: "Add to cart", enabled: true, section: "Blue Tee" }] };
const soldOut = { sections: [{ heading: "Blue Tee", level: 1, lines: ["Sold out"] }], buttons: [{ label: "Add to cart", enabled: false, section: "Blue Tee" }] };
const changed = { sections: [{ heading: "Something new", level: 1, lines: ["Whatever"] }], buttons: [] };
const regional = {
  sections: [
    { heading: "Blue Tee", level: 1, lines: [] },
    { heading: "Click and collect availability", level: 2, lines: ["Loughborough\t46", "Sheffield\t22", "Cardiff\t0"] },
  ],
  buttons: [],
};
const RULES = { pageChecks: [{ type: "text", text: "Blue Tee" }], inStock: [{ type: "button", label: "Add to cart", enabled: true }], outOfStock: [{ type: "text", text: "Sold out" }] };

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Email").fill(OWNER_EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(OWNER_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expectSignedIn(page);
}

async function openRules(page: Page) {
  await page.goto("/suppliers");
  await rowMenu(page, "Acme Supply", "Stock rules");
  await expect(page.getByRole("heading", { level: 1, name: "Stock rules" })).toBeVisible();
}

/** Captures one link's page and waits until it is saved, then labels it. */
async function captureAndLabel(page: Page, name: string, expected: "in_stock" | "out_of_stock" | "cannot_tell") {
  const allPages = page.getByRole("button", { name: "All pages" });
  if (await allPages.isVisible()) await allPages.click(); // on a phone the list and the page take turns
  await page.getByLabel("Link to capture").selectOption({ label: "Blue Tee · Size 1 · B0361" });
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  // Capturing twice in a row leaves two toasts on screen for a moment: look at the newest.
  await expect(page.getByText(/Capturing the page/).last()).toBeVisible();
  const saved = page.getByRole("list", { name: "Saved pages" }).getByRole("button").filter({ hasText: "Unnamed capture" }).filter({ hasText: /Saved / });
  await expect(saved.first()).toBeVisible({ timeout: 20_000 });
  await saved.first().click();
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Answer you expect").selectOption(expected);
  await page.getByRole("button", { name: "Save label" }).click();
  const words = { in_stock: "In stock", out_of_stock: "Out of stock", cannot_tell: "Cannot tell" }[expected];
  // Labelling twice in a row leaves two toasts on screen for a moment: look at the newest.
  await expect(page.getByText("Label saved.").last()).toBeVisible();
  // On a phone the list and the page take turns.
  const back = page.getByRole("button", { name: "All pages" });
  if (await back.isVisible()) await back.click();
  await expect(page.getByRole("list", { name: "Saved pages" }).getByRole("listitem").filter({ hasText: name })).toContainText(`Expected: ${words}`);
}

const scan = async (page: Page, label: string) => {
  await settle(page);
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(result.violations.map((v) => `${label}: ${v.id}`), label).toEqual([]);
};
const noSideScroll = async (page: Page, label: string) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), `${label} scrolls sideways`).toBe(false);
};
const row = (page: Page, name: RegExp) => page.getByRole("row", { name });

/** A stock check runs in the background. The page shows the answer when it is loaded again. */
async function expectCell(page: Page, name: RegExp, words: string | RegExp) {
  await expect(async () => {
    await page.reload();
    await expect(row(page, name)).toContainText(words, { timeout: 1500 });
  }).toPass({ timeout: 20_000 });
}

test("the owner captures pages, labels examples, builds rules, is stopped by a failing example, fixes it and turns the rules on", async ({ page }) => {
  await signIn(page);
  await openRules(page);
  await expect(page.getByText(/No saved pages yet/)).toBeVisible();

  await captureAndLabel(page, "In stock page", "in_stock");
  await page.getByRole("list", { name: "Saved pages" }).getByRole("button", { name: /In stock page/ }).click(); // on a phone this opens the page
  await expect(page.getByRole("img", { name: "Picture of the saved page" })).toBeVisible();
  await page.getByRole("tab", { name: "Page text" }).click();
  await expect(page.getByText("Soft cotton.")).toBeVisible();
  await control.browser({ description: soldOut });
  await captureAndLabel(page, "Sold out page", "out_of_stock");
  await page.getByRole("list", { name: "Saved pages" }).getByRole("button", { name: /Sold out page/ }).click();
  await expect(page.getByText(/Contains a picture of the page/).first()).toBeVisible();

  // A wrong rule: the sold-out example does not give the answer the owner expects.
  await page.getByLabel("Page checks rule 1 words").fill("Blue Tee");
  await page.getByRole("button", { name: "Add a rule to In stock when" }).click();
  await page.getByLabel("In stock when rule 1 type").selectOption("button");
  await page.getByLabel("In stock when rule 1 words").fill("Add to cart");
  await page.getByLabel("In stock when rule 1 button must be").selectOption("true");
  await page.getByRole("button", { name: "Add a rule to Out of stock when" }).click();
  await page.getByLabel("Out of stock when rule 1 words").fill("Gone");
  await page.getByRole("button", { name: "Save version" }).click();
  await expect(page.getByText(/Saved as version 1/)).toBeVisible();
  await page.getByRole("button", { name: "Test all examples" }).click();
  await expect(page.getByText("1 example does not give the answer you expect.")).toBeVisible();
  await expect(page.getByRole("list", { name: "Test results" })).toContainText("You expected Out of stock, the rules said Cannot tell");
  await expect(page.getByRole("button", { name: "Turn on version 1" })).toBeDisabled();
  await expect(page.getByText("Some examples do not give the answer you expect. Fix the rules and test again.")).toBeVisible();

  // The fix: now every example passes, and the new version can be turned on.
  await page.getByLabel("Out of stock when rule 1 words").fill("Sold out");
  await page.getByRole("button", { name: "Test all examples" }).click();
  await expect(page.getByText("All examples give the answer you expect.")).toBeVisible();
  await page.getByRole("button", { name: "Save version" }).click();
  await expect(page.getByText(/Saved as version 2/)).toBeVisible();
  await page.getByRole("button", { name: "Turn on version 2" }).click();
  await expect(page.getByText(/Version 2 is turned on/)).toBeVisible();
  await expect(page.getByRole("list", { name: "Versions" })).toContainText("Turned on");
});

test("a stock check shows in stock, out of stock and cannot tell, never calling a changed page or a puzzle out of stock", async ({ page }) => {
  await control.seedRecipe(RULES);
  await signIn(page);
  await page.goto("/mappings");
  const link = /Blue Tee.*Size 1/;
  const check = () => row(page, link).getByRole("button", { name: /^Check stock/ }).click();
  await expect(row(page, link)).toContainText("No stock check yet");

  await check();
  await expect(page.getByText(/stock check of Blue Tee \(Size 1\) has started/)).toBeVisible();
  await expectCell(page, link, "In stock");

  await control.browser({ description: soldOut });
  await check();
  await expectCell(page, link, "Out of stock");

  await control.browser({ description: changed });
  await check();
  await expectCell(page, link, "The page changed. Review the stock rules.");
  await expect(row(page, link).getByRole("link", { name: "Review stock rules" })).toBeVisible();
  await expect(row(page, link)).not.toContainText("Out of stock");

  await control.browser({ page: { result: "captcha", status: 403, finalUrl: null, title: null, heading: null, softNotFound: false } });
  await check();
  await expectCell(page, link, "The check did not work");
  await expect(row(page, link)).toContainText("Cannot tell");

  await row(page, link).getByRole("button", { name: /^More actions/ }).click();
  await page.getByRole("menuitem", { name: "History" }).click();
  const history = page.getByRole("list", { name: /Stock history for/ });
  await expect(history.getByRole("listitem")).toHaveCount(4);
  await expect(history).toContainText("In stock");
  await expect(history).toContainText("rules version 1");
});

test("when many pages change at once there is one dashboard notification, and a later good run clears it", async ({ page }) => {
  await control.seedRecipe(RULES);
  await control.browser({ description: changed });
  await signIn(page);
  await page.goto("/mappings");
  await page.getByLabel("Supplier", { exact: true }).selectOption({ label: "Acme Supply" });
  await page.getByRole("button", { name: "Check all stock for Acme Supply" }).click();
  await expect(page.getByText(/Checking stock for 6 links/)).toBeVisible();

  await expect(async () => {
    await page.goto("/");
    await expect(page.getByText("Acme Supply's pages changed. Review its stock rules.")).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 25_000 });
  await expect(page.getByText(/pages changed/)).toHaveCount(1);
  await page.getByRole("link", { name: "Review stock rules Acme Supply" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Stock rules" })).toBeVisible();

  await control.browser({ description: inStock });
  await page.goto("/mappings");
  await page.getByLabel("Supplier", { exact: true }).selectOption({ label: "Acme Supply" });
  await page.getByRole("button", { name: "Check all stock for Acme Supply" }).click();
  await expect(async () => {
    await page.goto("/");
    await expect(page.getByText("Nothing needs your attention.")).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 25_000 });
});

test("a region chosen in the app is read from the page's table: a number, zero, or not listed", async ({ page }) => {
  await control.seedRecipe({ pageChecks: [{ type: "text", text: "Blue Tee" }], inStock: [], outOfStock: [], region: { under: "Click and collect availability" } });
  await control.browser({ description: regional });
  await signIn(page);

  await page.goto("/suppliers");
  await rowMenu(page, "Acme Supply", "Edit");
  await page.getByLabel("Default region (optional)").fill("Loughborough");
  await page.getByRole("button", { name: "Save region" }).click();
  await expect(page.getByText("Region saved.")).toBeVisible();

  for (const [size, region] of [["Size 2", "Manchester"], ["Size 3", "Cardiff"]] as const) {
    await page.goto("/mappings");
    await rowMenu(page, `Blue Tee ${size}`, "Edit");
    await page.getByLabel("Region (optional)").fill(region);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page).toHaveURL(/\/mappings$/);
  }

  await page.goto("/mappings");
  for (const size of ["Size 1", "Size 2", "Size 3"]) await row(page, new RegExp(`Blue Tee.*${size}`)).getByRole("button", { name: /^Check stock/ }).click();
  await expectCell(page, /Blue Tee.*Size 1/, "In stock (46)");
  await expectCell(page, /Blue Tee.*Size 2/, "Out of stock: not listed for Manchester");
  await expectCell(page, /Blue Tee.*Size 3/, "Out of stock");

  // The table disappears: the same missing label is now a changed page, not out of stock.
  await control.browser({ description: changed });
  await row(page, /Blue Tee.*Size 2/).getByRole("button", { name: /^Check stock/ }).click();
  await expectCell(page, /Blue Tee.*Size 2/, "The page changed");
  await expect(row(page, /Blue Tee.*Size 2/)).not.toContainText("Out of stock");
});

test("the stock screens pass the accessibility scan in light and dark, and never scroll sideways", async ({ page }) => {
  await control.seedRecipe(RULES);
  await signIn(page);
  await openRules(page);
  await captureAndLabel(page, "In stock page", "in_stock");
  await page.getByLabel("Page checks rule 1 words").fill("Blue Tee");
  await page.getByRole("button", { name: "Test all examples" }).click();
  await expect(page.getByText(/example/).first()).toBeVisible();
  const rulesUrl = page.url();
  await page.goto("/mappings");
  await row(page, /Blue Tee.*Size 1/).getByRole("button", { name: /^Check stock/ }).click();
  await expectCell(page, /Blue Tee.*Size 1/, /In stock|Cannot tell/);
  await row(page, /Blue Tee.*Size 1/).getByRole("button", { name: /^More actions/ }).click();
  await page.getByRole("menuitem", { name: "History" }).click();

  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(rulesUrl);
    await expect(page.getByRole("heading", { name: "Saved pages" })).toBeVisible();
    await page.getByRole("list", { name: "Saved pages" }).getByRole("button", { name: /In stock page/ }).click();
    await expect(page.getByRole("img", { name: "Picture of the saved page" })).toBeVisible();
    await scan(page, `rules ${scheme}`);
    await noSideScroll(page, `rules ${scheme}`);

    await page.goto("/mappings");
    await expect(row(page, /Blue Tee.*Size 1/)).toBeVisible();
    await scan(page, `links ${scheme}`);
    await noSideScroll(page, `links ${scheme}`);

    await page.goto("/suppliers");
    await rowMenu(page, "Acme Supply", "Edit");
    await expect(page.getByLabel("Default region (optional)")).toBeVisible();
    await scan(page, `supplier ${scheme}`);
    await noSideScroll(page, `supplier ${scheme}`);

    await page.goto("/");
    await expect(page.getByRole("heading", { level: 2, name: "Stock answers" })).toBeVisible();
    await scan(page, `dashboard ${scheme}`);
  }
});
