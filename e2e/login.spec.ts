import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { OWNER_EMAIL, OWNER_PASSWORD } from "./constants.js";
import { expectSignedIn } from "./ui.js";

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Email").fill(OWNER_EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(OWNER_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expectSignedIn(page);
}

test("the owner signs in, sees the home page and signs out", async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await page.getByRole("button", { name: "Account" }).click();
  await expect(page.getByText(OWNER_EMAIL)).toBeVisible();

  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("after signing out the home page and the API are blocked", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Account" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
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

test("nothing scrolls sideways and every control is at least 44px tall", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  for (const control of await page.locator("input, button").all()) {
    const box = await control.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
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
  const menu = page.getByRole("button", { name: "Menu" });
  if (await menu.isVisible()) await menu.click(); // on a phone the navigation opens from the Menu button
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: "Proposals" })).toHaveAttribute("href", "/proposals");
  await expect(nav.getByText("History")).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Suppliers" })).toHaveAttribute("href", "/suppliers");
  await expect(nav.getByRole("link", { name: "Products" })).toHaveAttribute("href", "/products");
  await expect(nav.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings/shopify");
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
  await expect(page.getByRole("button", { name: "Account" })).toBeInViewport();
});
