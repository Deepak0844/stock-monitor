// The redesign's final sweep: every main page passes the accessibility scan in light and dark, at desktop and phone width, and
// never scrolls sideways. Screenshots are kept in test-results/redesign for the pull request. Runs in the desktop and phone
// projects; the width is set here so each project checks both layouts.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { OWNER_EMAIL, OWNER_PASSWORD } from "./constants.js";
import { expectSignedIn, settle } from "./ui.js";

const PAGES = ["/", "/suppliers", "/mappings", "/products", "/proposals", "/settings/shopify", "/settings/appearance", "/mappings/new"];
const SIZES = [
  { name: "phone", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Email").fill(OWNER_EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(OWNER_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expectSignedIn(page);
}

async function check(page: Page, label: string, shot: string) {
  await page.waitForLoadState("networkidle");
  await settle(page);
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(result.violations.map((v) => `${label}: ${v.id} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`), label).toEqual([]);
  const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(sideways, `${label} scrolls sideways`).toBeLessThanOrEqual(0);
  await page.screenshot({ path: `test-results/redesign/${shot}.png` });
}

test("every main page passes the accessibility scan in light and dark, on a phone and a wide screen, and never scrolls sideways", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "one run covers both widths and both themes");
  test.setTimeout(180_000);
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    for (const size of SIZES) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto("/login");
      await check(page, `sign in, ${theme}, ${size.name}`, `signin-${size.name}-${theme}`);
      await signIn(page);
      for (const path of PAGES) {
        await page.goto(path);
        await expectSignedIn(page);
        const name = path === "/" ? "dashboard" : path.slice(1).replace(/\//g, "-");
        await check(page, `${path}, ${theme}, ${size.name}`, `${name}-${size.name}-${theme}`);
      }
      await page.context().clearCookies();
    }
  }
});

test("a very long supplier name with no spaces never pushes a phone screen sideways", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "sets the phone width itself");
  await signIn(page);
  const name = "Northline" + "W".repeat(91); // 100 characters, the longest name allowed, with no spaces
  const res = await page.request.post("/api/suppliers", { data: { name, websiteUrl: "https://shop.longname.example/", loginUrl: null } });
  expect(res.status()).toBe(201);
  const { supplier } = (await res.json()) as { supplier: { id: string } };
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    for (const path of ["/suppliers", "/"]) {
      await page.goto(path);
      await expect(page.getByText(name).first()).toBeVisible();
      const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(sideways, `${path} scrolls sideways`).toBeLessThanOrEqual(0);
    }
  } finally {
    await page.request.delete(`/api/suppliers/${supplier.id}`);
  }
});
