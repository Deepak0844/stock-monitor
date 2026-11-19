// Small helpers for the parts of the screens the browser tests all use.
import { expect, type Page } from "@playwright/test";

/** Opens the "more actions" menu of one row, as named by the row's own subject, and chooses one item. */
export async function rowMenu(page: Page, subject: string, item: string | RegExp) {
  await page.getByRole("button", { name: `More actions for ${subject}` }).click();
  await page.getByRole("menuitem", { name: item }).click();
}

/** The page is signed in and showing. On a phone the sidebar is closed, so the top bar is the proof. */
export const expectSignedIn = (page: Page) => expect(page.getByRole("navigation", { name: "Breadcrumb" })).toBeVisible();

/**
 * Waits for every animation that ends (a dialog fading in) before a scan, so the colours are measured at rest. Animations that
 * never end, such as a loading shimmer, are left alone.
 */
export const settle = (page: Page) =>
  page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );

/** Chooses a supplier in the Links filters. On a phone the filters are behind one Filters button, on a full screen. */
export async function pickLinksSupplier(page: Page, name: RegExp) {
  const filters = page.getByRole("button", { name: /^Filters/ });
  const phone = await filters.isVisible();
  if (phone) await filters.click();
  await page.getByRole("button", { name: /^Supplier:/ }).click();
  await page.getByRole("option", { name }).click();
  if (phone) await page.getByRole("button", { name: "Done" }).click();
}
