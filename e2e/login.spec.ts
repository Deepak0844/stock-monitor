import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { OWNER_EMAIL, OWNER_PASSWORD } from "./constants.js";
import { expectSignedIn } from "./ui.js";

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Email").fill(OWNER_EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(OWNER_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expectSignedIn(page);
}

/** On a wide screen sign out is in the Account menu; on a phone it is under More in the tabs at the bottom. */
async function openAccount(page: Page) {
  const more = page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "More" });
  if (await more.isVisible()) {
    await more.click();
    return page.getByRole("dialog", { name: "More" });
  }
  await page.getByRole("button", { name: "Account" }).click();
  return page.getByRole("menu");
}
const signOutFrom = (panel: Locator) => panel.getByRole("button", { name: "Sign out" }).or(panel.getByRole("menuitem", { name: "Sign out" }));

test("the owner signs in, sees the home page and signs out", async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  const panel = await openAccount(page);
  await expect(panel.getByText(OWNER_EMAIL)).toBeVisible();

  await signOutFrom(panel).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("after signing out the home page and the API are blocked", async ({ page }) => {
  await signIn(page);
  await signOutFrom(await openAccount(page)).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Account" })).toHaveCount(0);
  expect((await page.request.get("/api/me")).status()).toBe(401);
});

test("the session survives a page reload while signed in", async ({ page }) => {
  await signIn(page);
  await page.reload();
  await expectSignedIn(page);
});

test("a wrong password shows a clear message and keeps the owner on the sign-in page", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email").fill(OWNER_EMAIL);
  await page.getByLabel("Password", { exact: true }).fill("not the right password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toHaveText("Email or password is incorrect.");
  await expect(page.getByLabel("Email")).toHaveValue(OWNER_EMAIL);
  await expect(page.getByRole("button", { name: "Account" })).toHaveCount(0);
});

test("empty fields are explained next to each field", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Enter your email address.")).toBeVisible();
  await expect(page.getByText("Enter your password.")).toBeVisible();
  await expect(page.getByLabel("Email")).toBeFocused();
});

test("the whole sign-in works from the keyboard alone", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email").focus();
  await page.keyboard.type(OWNER_EMAIL);
  await page.keyboard.press("Tab");
  await page.keyboard.type(OWNER_PASSWORD);
  await page.keyboard.press("Enter");
  await expectSignedIn(page);
});

test("the pages load with no script errors, blocked resources or unexpected failed requests", async ({ page }) => {
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  // Chrome logs every failed request as "Failed to load resource". Those are checked below by URL.
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(e.message));
  page.on("response", (r) => {
    const expectedSignedOutCheck = r.url().endsWith("/api/me") && r.status() === 401;
    if (r.status() >= 400 && !expectedSignedOutCheck) failedRequests.push(`${r.status()} ${r.url()}`);
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await signIn(page);
  expect(consoleErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
});

test("the sign-in and home pages have no detectable accessibility violations", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  const signedOut = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(signedOut.violations).toEqual([]);

  await signIn(page);
  const signedIn = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(signedIn.violations).toEqual([]);
});

// The owner's sizes: controls are 44px tall on a phone and 32px on a wide screen (1024px and up).
test("nothing scrolls sideways, and controls are 44px tall on a phone and 32px on a wide screen", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const minimum = page.viewportSize()!.width >= 1024 ? 32 : 44;
  for (const control of await page.locator("input, button").all()) {
    const box = await control.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(minimum);
  }
});

test("the API sends security headers with the page", async ({ page }) => {
  const res = await page.goto("/");
  expect(res!.headers()["x-frame-options"]).toBe("DENY");
  expect(res!.headers()["content-security-policy"]).toContain("default-src 'self'");
});

test("the pages also pass the accessibility scan in dark mode", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  const signedOut = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(signedOut.violations).toEqual([]);

  await signIn(page);
  const signedIn = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(signedIn.violations).toEqual([]);
});

test("the navigation links to every section, with no dead items", async ({ page }) => {
  await signIn(page);
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: "Proposals" })).toHaveAttribute("href", "/proposals");
  await expect(nav.getByText("History")).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Suppliers" })).toHaveAttribute("href", "/suppliers");
  await expect(nav.getByRole("link", { name: "Links" })).toHaveAttribute("href", "/mappings");
  // On a phone, Products and Settings sit under More in the tabs at the bottom.
  const more = nav.getByRole("button", { name: "More" });
  const rest = (await more.isVisible()) ? (await more.click(), page.getByRole("dialog", { name: "More" })) : nav;
  await expect(rest.getByRole("link", { name: "Products" })).toHaveAttribute("href", "/products");
  await expect(rest.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings/shopify");
});

test("Tab reaches the skip link first and it jumps to the main content", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard Tab order is checked on desktop");
  await signIn(page);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to main content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
});

test("sign out is reachable on a phone without scrolling to the bottom", async ({ page, isMobile }) => {
  test.skip(!isMobile, "phone layout only");
  await signIn(page);
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "More" })).toBeInViewport();
  await expect(signOutFrom(await openAccount(page))).toBeInViewport();
});
