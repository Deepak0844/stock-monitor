// The link screens, through the real stack: the real API, worker and database, a real browser, a stand-in browser
// service, and no real supplier. They reset the suppliers and the variants, so they run in their own projects,
// after every other journey, and one after another.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { OWNER_EMAIL, OWNER_PASSWORD } from "./constants.js";
import { control } from "./control.js";

test.describe.configure({ mode: "serial" });
const EXPORT = fileURLToPath(new URL("./fixtures/shopify-export.csv", import.meta.url));

test.beforeEach(async () => {
  await control.resetMappings();
});

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Email").fill(OWNER_EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(OWNER_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

/** On a phone the navigation sits behind the Menu button. */
async function openLinks(page: Page) {
  const menu = page.getByRole("button", { name: "Menu" });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Links" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Links" })).toBeVisible();
}

async function importExport(page: Page) {
  await page.getByRole("link", { name: "Import from Shopify export" }).first().click();
  await page.getByLabel("Shopify product export (CSV)").setInputFiles(EXPORT);
  await expect(page.getByLabel("SKU column")).toBeVisible();
  await page.getByRole("button", { name: "Show preview" }).click();
  await expect(page.getByRole("heading", { name: "3. Preview" })).toBeVisible();
}

const scan = async (page: Page, label: string) => {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(result.violations.map((v) => `${label}: ${v.id}`), label).toEqual([]);
};
const noSideScroll = async (page: Page, label: string) => {
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(wide, `${label} scrolls sideways`).toBe(false);
};
const row = (page: Page, name: RegExp) => page.getByRole("row", { name });

/** A link check runs in the background. The page shows the result when it is loaded again. */
async function expectStatus(page: Page, name: RegExp, words: string) {
  await expect(async () => {
    await page.reload();
    await expect(row(page, name)).toContainText(words, { timeout: 1500 });
  }).toPass({ timeout: 20_000 });
}

test("the owner imports the Shopify export, sees the preview, saves, and importing the same file again changes nothing", async ({ page }) => {
  await signIn(page);
  await openLinks(page);
  await expect(page.getByText(/No links yet/)).toBeVisible();
  await expect(page.getByText("3 of 3 variants are not mapped")).toBeVisible();

  await importExport(page);
  await expect(page.getByText("2 links are ready to save")).toBeVisible();
  await expect(page.getByText(/2 new, 0 replaced, 0 unchanged/)).toBeVisible();
  await expect(page.getByText("1 row is for suppliers not in the app.")).toBeVisible();
  await expect(page.getByText(/Line 6.*not on this supplier's website/)).toBeVisible();
  await expect(page.getByText(/Line 7.*SKU NOPE matches no variant/)).toBeVisible();
  await expect(page.getByText("Another row in this file uses the same page address.")).toBeVisible();
  await page.getByRole("button", { name: "Save 2 links" }).click();
  await expect(page.getByText(/2 new links saved/)).toBeVisible();

  await page.getByRole("link", { name: "Go to links" }).click();
  const first = row(page, /Blue Tee.*Large/);
  await expect(first).toContainText("B0361");
  await expect(first).toContainText("shop.acme.example/p/blue-tee");
  await expect(first).toContainText("Not checked");
  await expect(page.getByText("1 of 3 variants are not mapped")).toBeVisible();

  await importExport(page);
  await expect(page.getByText(/0 new, 0 replaced, 2 unchanged/)).toBeVisible();
  await page.getByRole("button", { name: "Save 2 links" }).click();
  await expect(page.getByText(/0 new links saved, 0 replaced, 2 unchanged/)).toBeVisible();
  await page.getByRole("link", { name: "Go to links" }).click();
  await expect(page.getByRole("row", { name: /Blue Tee/ })).toHaveCount(2);
});

test("the owner maps a variant by hand from the list of variants with no link, with a plain error for another website", async ({ page }) => {
  await signIn(page);
  await openLinks(page);
  await page.getByRole("link", { name: "Map Blue Tee Medium" }).click();
  await expect(page.getByLabel("Variant", { exact: true })).toHaveValue("v3");
  await page.getByLabel("Supplier", { exact: true }).selectOption({ label: "Acme Supply" });
  await page.getByLabel("Supplier page address").fill("https://other.example/p");
  await page.getByRole("button", { name: "Add link" }).click();
  await expect(page.getByText("That address is not on this supplier's website.")).toBeVisible();
  await page.getByLabel("Supplier page address").fill("https://shop.acme.example/p/blue-tee-m");
  await page.getByRole("button", { name: "Add link" }).click();
  await expect(page).toHaveURL(/\/mappings$/);
  await expect(row(page, /Blue Tee.*Medium/)).toContainText("shop.acme.example/p/blue-tee-m");
  await expect(page.getByText("2 of 3 variants are not mapped")).toBeVisible();
});

test("a link check needs recorded permission, then shows works, page missing, and needs login without breaking the link", async ({ page }) => {
  await signIn(page);
  await openLinks(page);
  await page.getByRole("link", { name: "Map Blue Tee Medium" }).click();
  await page.getByLabel("Supplier", { exact: true }).selectOption({ label: "Acme Supply" });
  await page.getByLabel("Supplier page address").fill("https://shop.acme.example/p/blue-tee-m");
  await page.getByRole("button", { name: "Add link" }).click();
  const blue = row(page, /Blue Tee.*Medium/);

  // Permission is not recorded: refused in plain words, nothing is sent.
  await blue.getByRole("button", { name: /Check now/ }).click();
  await expect(page.getByRole("alert")).toContainText("You have not recorded permission to check this supplier automatically");

  await page.goto("/suppliers");
  await page.getByRole("link", { name: "Edit Acme Supply" }).click();
  const permission = page.getByRole("group", { name: "Permission to check automatically" });
  await expect(permission).toContainText("Not recorded");
  await permission.getByLabel("Permission", { exact: true }).selectOption("granted");
  await permission.getByLabel("Note about the permission (optional)").fill("Agreed by email");
  await permission.getByRole("button", { name: "Save permission" }).click();
  await expect(page.getByText("Permission saved.")).toBeVisible();

  await page.goto("/mappings");
  await blue.getByRole("button", { name: /Check now/ }).click();
  await expect(page.getByText(/has started/)).toBeVisible();
  await expectStatus(page, /Blue Tee.*Medium/, "Works");

  // The page is gone: it worked before, so it is missing, and the owner is told since when.
  await control.browser({ page: { result: "ok", status: 404, title: "Not found", heading: "Not found", softNotFound: true } });
  await blue.getByRole("button", { name: /Check now/ }).click();
  await expectStatus(page, /Blue Tee.*Medium/, "Page missing");
  await expect(blue).toContainText("Worked until");
  await expect(blue).not.toContainText("May be unavailable"); // one check is not enough

  // A puzzle is the supplier's problem, not a broken link, and the supplier is marked Blocked.
  await control.browser({ page: { result: "captcha", status: 403, finalUrl: null, title: null, heading: null, softNotFound: false } });
  await blue.getByRole("button", { name: /Check now/ }).click();
  await expectStatus(page, /Blue Tee.*Medium/, "Needs login");
  await page.goto("/suppliers");
  await expect(page.getByRole("row", { name: /Acme Supply/ })).toContainText("Blocked");
});

test("the link screens pass the accessibility scan in light and dark, and never scroll sideways", async ({ page }) => {
  await signIn(page);
  await openLinks(page);
  await importExport(page);
  await page.getByRole("button", { name: "Save 2 links" }).click();
  await expect(page.getByText(/2 new links saved/)).toBeVisible();
  await page.getByRole("link", { name: "Go to links" }).click();
  await expect(row(page, /Blue Tee.*Large/)).toBeVisible();

  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/mappings");
    await expect(row(page, /Blue Tee.*Large/)).toBeVisible();
    await scan(page, `links ${scheme}`);
    await noSideScroll(page, `links ${scheme}`);

    await page.goto("/mappings/new");
    await expect(page.getByLabel("Variant", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Add link" }).click(); // shows every error beside its field
    await expect(page.getByText("Choose the supplier.")).toBeVisible();
    await scan(page, `add link with errors ${scheme}`);
    await noSideScroll(page, `add link ${scheme}`);

    await page.goto("/mappings");
    await page.getByRole("link", { name: "Edit link Blue Tee Large" }).click();
    await expect(page.getByLabel("Supplier page address")).toBeVisible();
    await scan(page, `edit link ${scheme}`);

    await page.goto("/mappings");
    await importExport(page);
    await scan(page, `import preview ${scheme}`);
    await noSideScroll(page, `import preview ${scheme}`);

    await page.goto("/suppliers");
    await page.getByRole("link", { name: "Edit Acme Supply" }).click();
    await expect(page.getByRole("group", { name: "Permission to check automatically" })).toBeVisible();
    await scan(page, `permission ${scheme}`);
    await noSideScroll(page, `permission ${scheme}`);

    await page.goto("/");
    await expect(page.getByRole("heading", { level: 2, name: "Supplier links" })).toBeVisible();
    await scan(page, `dashboard ${scheme}`);
  }
});
