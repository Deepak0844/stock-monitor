// Automatic checks, through the real stack: the real API, worker and database, a real browser, a stand-in browser service that
// returns made-up pages, and no real supplier. The scheduler's cron is not running here: a test asks for one pass with
// `control.tick(minutes)`, as if that many minutes had gone by, so nothing waits real hours. They reset the suppliers and the
// variants, so they run in their own projects, after every other journey, and one after another.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { OWNER_EMAIL, OWNER_PASSWORD } from "./constants.js";
import { control } from "./control.js";
import { expectSignedIn, rowMenu, settle } from "./ui.js";

test.describe.configure({ mode: "serial" });

const RULES = { pageChecks: [{ type: "text", text: "Blue Tee" }], inStock: [{ type: "button", label: "Add to cart", enabled: true }], outOfStock: [{ type: "text", text: "Sold out" }] };
const LOGIN_PAGE = { result: "login_required", status: 200, finalUrl: null, title: null, heading: null, softNotFound: false };
const DAY = 1700; // minutes: past a day plus the largest spread (10%)

test.beforeEach(async () => {
  await control.resetExtraction();
  await control.seedRecipe(RULES);
});

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Email").fill(OWNER_EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(OWNER_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expectSignedIn(page);
}

/** Turns automatic checks on for Acme Supply through the screen. */
async function turnOn(page: Page, interval = "1440", anyTime = true) {
  await page.goto("/suppliers");
  await rowMenu(page, "Acme Supply", "Edit");
  await page.getByLabel("How often").selectOption(interval);
  if (anyTime) await page.getByLabel("Any time of day").check();
  await page.getByRole("button", { name: "Save automatic checks" }).click();
  await expect(page.getByText("Automatic checks saved.")).toBeVisible();
}

const supplierRow = (page: Page) => page.getByRole("row", { name: /Acme Supply/ });
async function expectRow(page: Page, words: string | RegExp) {
  await expect(async () => {
    await page.goto("/suppliers");
    await expect(supplierRow(page)).toContainText(words, { timeout: 1500 });
  }).toPass({ timeout: 20_000 });
}
/** Waits until the supplier has no run going (a check runs in the background). */
async function waitForRunEnd(page: Page) {
  const { suppliers } = (await page.request.get("/api/suppliers").then((r) => r.json())) as { suppliers: { id: string }[] };
  await expect
    .poll(async () => ((await page.request.get(`/api/suppliers/${suppliers[0]!.id}/runs/current`).then((r) => r.json())) as { run: unknown }).run, { timeout: 30_000 })
    .toBeNull();
}
const scan = async (page: Page, label: string) => {
  await settle(page);
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(result.violations.map((v) => `${label}: ${v.id}`), label).toEqual([]);
};
const noSideScroll = async (page: Page, label: string) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), `${label} scrolls sideways`).toBe(false);
};

test("the owner turns on daily checks, a due check runs by itself, and the list shows progress and the summary", async ({ page }) => {
  await signIn(page);
  await page.goto("/suppliers");
  await expect(supplierRow(page)).toContainText("Automatic checks off");
  await turnOn(page);
  await page.goto("/suppliers");
  await expect(supplierRow(page)).toContainText(/Every day, next check/);

  // Not due yet: nothing starts.
  expect((await control.tick(60)).started).toEqual([]);
  // A day later it is due: it starts once, and does not start again while it runs or before it is due again.
  await control.browser({ delayMs: 1200 });
  const first = await control.tick(DAY);
  expect(first.started).toHaveLength(1);
  expect((await control.tick(DAY)).started).toEqual([]);
  await expectRow(page, /Checking \d of 6 links/);
  await control.browser({ delayMs: 0 });
  await expectRow(page, /Checked 6 links/);
  await expect(supplierRow(page)).toContainText(/Every day, next check/);

  // The run is in the history on the supplier's page.
  await rowMenu(page, "Acme Supply", "Edit");
  await expect(page.getByRole("table", { name: "Recent checks" })).toContainText("Scheduled");
  await expect(page.getByRole("table", { name: "Recent checks" })).toContainText(/Checked 6 links/);
});

test("Check now during a run is refused in plain words, then works once it has finished", async ({ page }) => {
  await signIn(page);
  await control.browser({ delayMs: 700 });
  await page.goto("/mappings");
  await page.getByLabel("Supplier", { exact: true }).selectOption({ label: "Acme Supply" });
  await page.getByRole("button", { name: "Check all stock for Acme Supply" }).click();
  await expect(page.getByText(/Checking stock for 6 links/)).toBeVisible();
  await page.getByRole("button", { name: "Check all stock for Acme Supply" }).click();
  await expect(page.getByRole("alert")).toContainText("already running");
  await control.browser({ delayMs: 0 });
  await waitForRunEnd(page);
  await page.goto("/mappings");
  await page.getByLabel("Supplier", { exact: true }).selectOption({ label: "Acme Supply" });
  await page.getByRole("button", { name: "Check all stock for Acme Supply" }).click();
  await expect(page.getByText(/Checking stock for 6 links/)).toBeVisible();
});

test("a login that has expired stops the run, tells the owner, and the schedule does not try again", async ({ page }) => {
  await signIn(page);
  await turnOn(page);
  await control.browser({ page: LOGIN_PAGE });
  expect((await control.tick(DAY)).started).toHaveLength(1);
  await expectRow(page, /Not being checked/);
  await expect(supplierRow(page)).toContainText(/Stopped after 1 of 6 links. The supplier asked you to log in again/);
  await page.goto("/");
  await expect(page.getByText("Acme Supply needs you to log in again.")).toBeVisible();
  const again = await control.tick(DAY * 2);
  expect(again.started).toEqual([]);
  expect(again.skipped).toHaveLength(1);
});

test("a supplier that is not recorded as allowed is not checked, and the screen says why", async ({ page }) => {
  await signIn(page);
  await turnOn(page);
  await page.goto("/suppliers");
  await rowMenu(page, "Acme Supply", "Edit");
  await page.getByLabel("Permission", { exact: true }).selectOption("unknown");
  await page.getByRole("button", { name: "Save permission" }).click();
  await expect(page.getByText("Permission saved.")).toBeVisible();
  expect((await control.tick(DAY)).started).toEqual([]);
  await expectRow(page, /Not being checked.*recorded permission/);
});

test("the quiet hours start at 07:00 to 22:00 and an end time equal to the start is refused", async ({ page }) => {
  await signIn(page);
  await page.goto("/suppliers");
  await rowMenu(page, "Acme Supply", "Edit");
  await expect(page.getByLabel("From")).toHaveValue("07:00");
  await expect(page.getByLabel("Until")).toHaveValue("22:00");
  await page.getByLabel("How often").selectOption("360");
  await page.getByLabel("Until").fill("07:00");
  await page.getByRole("button", { name: "Save automatic checks" }).click();
  await expect(page.getByText(/different/)).toBeVisible();
});

test("the automatic check screens pass the accessibility scan in light and dark, and never scroll sideways", async ({ page }) => {
  await signIn(page);
  await turnOn(page);
  expect((await control.tick(DAY)).started).toHaveLength(1);
  await expectRow(page, /Checked 6 links/);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/suppliers");
    await expect(supplierRow(page)).toBeVisible();
    await scan(page, `suppliers ${scheme}`);
    await noSideScroll(page, `suppliers ${scheme}`);
    await rowMenu(page, "Acme Supply", "Edit");
    await expect(page.getByRole("table", { name: "Recent checks" })).toBeVisible();
    await scan(page, `schedule panel ${scheme}`);
    await noSideScroll(page, `schedule panel ${scheme}`);
  }
});

test("run history never shows page addresses or session data", async ({ page }) => {
  await signIn(page);
  await turnOn(page);
  expect((await control.tick(DAY)).started).toHaveLength(1);
  await expectRow(page, /Checked 6 links/);
  const text = JSON.stringify(await page.request.get("/api/schedule").then((r) => r.json()));
  expect(text).not.toContain("acme.example");
  expect(text).not.toMatch(/cookie|token|session-secret/i);
  const runs = await page.request.get("/api/suppliers").then((r) => r.json() as Promise<{ suppliers: { id: string }[] }>);
  const history = JSON.stringify(await page.request.get(`/api/suppliers/${runs.suppliers[0]!.id}/runs`).then((r) => r.json()));
  expect(history).not.toContain("acme.example");
});
