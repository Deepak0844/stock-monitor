// The supplier screens, through the real stack: the real API and database, a real browser, and a
// fake DNS so no test touches the internet. They share one suppliers table, so they run one after another.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { OWNER_EMAIL, OWNER_PASSWORD } from "./constants.js";
import { control } from "./control.js";

test.describe.configure({ mode: "serial" });

test.beforeEach(async () => {
  await control.resetSuppliers();
});

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Email").fill(OWNER_EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(OWNER_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

/** On a phone the navigation sits behind the Menu button. */
async function openSuppliers(page: Page) {
  const menu = page.getByRole("button", { name: "Menu" });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Suppliers" }).click();
  await expect(page.getByRole("heading", { name: "Suppliers" })).toBeVisible();
}

async function addSupplier(page: Page, name: string, website = "https://shop.acme.example/") {
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Website address").fill(website);
  await page.getByRole("button", { name: "Add supplier" }).click();
}

const scan = async (page: Page, label: string) => {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(result.violations.map((v) => `${label}: ${v.id}`), label).toEqual([]);
};

// Set SHOTS to a folder to keep a picture of each state for a visual review.
const shot = async (page: Page, name: string, project: string) => {
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/${project}-${name}.png`, fullPage: true });
};

test("the Suppliers page starts empty, then an owner can add, edit, pause, resume and delete a supplier", async ({ page }, info) => {
  await signIn(page);
  await openSuppliers(page);
  await expect(page.getByText("No suppliers yet. Add your first supplier.")).toBeVisible();
  await shot(page, "empty", info.project.name);

  await page.getByRole("link", { name: "Add supplier" }).click();
  await addSupplier(page, "Acme Supply");
  await expect(page).toHaveURL(/\/suppliers$/);
  const row = page.getByRole("row", { name: /Acme Supply/ });
  await expect(row).toContainText("shop.acme.example");
  await expect(row).toContainText("Not connected");
  await expect(row).toContainText("Never");

  await page.getByRole("link", { name: "Add supplier" }).click();
  await addSupplier(page, "Globex", "https://globex.example/");
  await expect(page.getByRole("row", { name: /Globex/ })).toBeVisible();
  await shot(page, "list", info.project.name);

  await page.getByRole("button", { name: "Pause Acme Supply" }).click();
  await expect(page.getByRole("row", { name: /Acme Supply/ })).toContainText("Paused");
  await expect(page.getByRole("row", { name: /Globex/ })).toContainText("Not connected");
  await page.reload();
  await expect(page.getByRole("row", { name: /Acme Supply/ })).toContainText("Paused");
  await page.getByRole("button", { name: "Resume Acme Supply" }).click();
  await expect(page.getByRole("row", { name: /Acme Supply/ })).toContainText("Not connected");

  await page.getByRole("link", { name: "Edit Acme Supply" }).click();
  await expect(page.getByLabel("Name")).toHaveValue("Acme Supply");
  await page.getByLabel("Name").fill("Acme Ltd");
  await page.getByLabel(/Check every/).fill("120");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("row", { name: /Acme Ltd/ })).toBeVisible();

  await page.getByRole("button", { name: "Delete Acme Ltd" }).click();
  await expect(page.getByRole("group", { name: "Confirm delete" })).toContainText("cannot be undone");
  await shot(page, "confirm-delete", info.project.name);
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("row", { name: /Acme Ltd/ })).toBeVisible();
  await page.getByRole("button", { name: "Delete Acme Ltd" }).click();
  await page.getByRole("button", { name: "Yes, delete" }).click();
  await expect(page.getByText("Deleted Acme Ltd.")).toBeVisible();
  await expect(page.getByRole("row", { name: /Acme Ltd/ })).toHaveCount(0);
  await expect(page.getByRole("row", { name: /Globex/ })).toBeVisible();
});

test("each problem with a supplier is explained in plain words beside its own field", async ({ page }, info) => {
  await signIn(page);
  await page.goto("/suppliers/new");

  await page.getByRole("button", { name: "Add supplier" }).click();
  await expect(page.getByText("Enter a name for the supplier.")).toBeVisible();
  await expect(page.getByText(/Enter the supplier's website address/)).toBeVisible();
  await shot(page, "form-missing", info.project.name);

  await addSupplier(page, "Bad Http", "http://shop.example/");
  await expect(page.getByText(/starting with https:\/\//i).first()).toBeVisible();
  await expect(page.getByLabel("Website address")).toHaveAttribute("aria-invalid", "true");
  await page.getByLabel("Website address").fill("https://127.0.0.1/");
  await page.getByRole("button", { name: "Add supplier" }).click();
  await expect(page.getByText("Use the website's name, not an IP address.")).toBeVisible();
  await page.getByLabel("Website address").fill("https://internal.example/");
  await page.getByRole("button", { name: "Add supplier" }).click();
  await expect(page.getByText("That address points to a private or internal network, so it cannot be used.")).toBeVisible();
  await shot(page, "form-refused", info.project.name);
  await expect(page).toHaveURL(/\/suppliers\/new$/);

  await page.getByLabel("Website address").fill("https://ok.example/");
  await page.getByLabel(/Check every/).fill("5");
  await page.getByRole("button", { name: "Add supplier" }).click();
  await expect(page.getByText("Enter a whole number of minutes from 15 to 1440.")).toBeVisible();
  await page.getByLabel(/Check every/).fill("60");
  await page.getByLabel("Name").fill("First");
  await page.getByRole("button", { name: "Add supplier" }).click();
  await expect(page.getByRole("row", { name: /First/ })).toBeVisible();

  await page.goto("/suppliers/new");
  await addSupplier(page, "first", "https://other.example/");
  await expect(page.getByText("You already have a supplier with that name.")).toBeVisible();
  await expect(page.getByLabel("Name")).toBeFocused();
});

test("an address for a supplier that does not exist says so, with a way back", async ({ page }) => {
  await signIn(page);
  await page.goto("/suppliers/00000000-0000-4000-8000-000000000000/edit");
  await expect(page.getByRole("alert")).toContainText("That supplier does not exist.");
  await page.getByRole("link", { name: "Back to suppliers" }).click();
  await expect(page.getByRole("heading", { name: "Suppliers" })).toBeVisible();
});

test("the supplier screens pass the accessibility scan in light and dark, and never scroll sideways", async ({ page }, info) => {
  await signIn(page);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await control.resetSuppliers();

    await page.goto("/suppliers");
    await expect(page.getByText("No suppliers yet. Add your first supplier.")).toBeVisible();
    await scan(page, `${scheme} suppliers, empty`);

    await page.goto("/suppliers/new");
    await page.getByRole("button", { name: "Add supplier" }).click();
    await expect(page.getByText("Enter a name for the supplier.")).toBeVisible();
    await scan(page, `${scheme} form, with messages`);

    await page.getByLabel("Name").fill("Acme Supply");
    await page.getByLabel("Website address").fill("https://shop.acme.example/");
    await page.getByRole("button", { name: "Add supplier" }).click();
    await page.goto("/suppliers/new");
    await addSupplier(page, "Globex Wholesale Distribution Company", "https://very-long-supplier-name.example/products/login");
    await expect(page.getByRole("row", { name: /Globex/ })).toBeVisible();
    await page.getByRole("button", { name: "Pause Globex Wholesale Distribution Company" }).click();
    await expect(page.getByRole("row", { name: /Globex/ })).toContainText("Paused");
    await scan(page, `${scheme} suppliers, list`);
    await shot(page, `list-${scheme}`, info.project.name);

    await page.getByRole("button", { name: "Delete Acme Supply" }).click();
    await expect(page.getByRole("group", { name: "Confirm delete" })).toBeVisible();
    await scan(page, `${scheme} suppliers, confirming delete`);

    await page.getByRole("link", { name: "Edit Acme Supply" }).click();
    await expect(page.getByLabel("Name")).toHaveValue("Acme Supply");
    await scan(page, `${scheme} form, editing`);

    for (const path of ["/suppliers", "/suppliers/new"]) {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${scheme} ${path} must not scroll sideways`).toBeLessThanOrEqual(0);
    }
  }
});
