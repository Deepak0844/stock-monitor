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

// ---------------------------------------------------------------------------------------------------------
// Connecting a supplier. The real page, noVNC, the WebSocket proxy, the API and the database run for real. The
// browser service is a stand-in, and its screen is a stand-in VNC server that draws a login page.

const E2E_SESSION = { cookies: [{ name: "session", value: "e2e-session-value", domain: "shop.acme.example", path: "/" }], origins: [] };

/** Adds a supplier through the API, as the signed-in owner, and returns where its connect screen is. */
async function addViaApi(page: Page, name = "Acme Supply") {
  const res = await page.request.post("/api/suppliers", { data: { name, websiteUrl: "https://shop.acme.example/account", loginUrl: "https://shop.acme.example/login" } });
  expect(res.status()).toBe(201);
  const supplier = (await res.json()) as { supplier: { id: string } };
  return { id: supplier.supplier.id, url: `/suppliers/${supplier.supplier.id}/connect` };
}
const liveCanvas = (page: Page) => page.locator(".screen canvas");

test("the owner connects a supplier: the login window appears, they press I'm logged in, and the supplier is connected", async ({ page }, info) => {
  const problems: string[] = [];
  page.on("console", (m) => /content security policy|refused to/i.test(m.text()) && problems.push(m.text()));
  const frames: string[] = [];
  const socketUrls: string[] = [];
  page.on("websocket", (ws) => {
    socketUrls.push(ws.url());
    ws.on("framesent", (f) => frames.push(typeof f.payload === "string" ? f.payload : "(binary)"));
  });

  await signIn(page);
  const supplier = await addViaApi(page);
  await page.goto(supplier.url);
  await expect(page.getByRole("heading", { level: 1, name: "Connect Acme Supply" })).toBeVisible();
  await expect(liveCanvas(page)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("timer")).toContainText("Time left:");
  const done = page.getByRole("button", { name: "I'm logged in" });
  await expect(done).toBeEnabled();
  await shot(page, "connect-live", info.project.name);

  // The token goes as the first message, and is never in the address. The viewer's password login follows.
  expect(socketUrls).toHaveLength(1);
  expect(socketUrls[0]).toMatch(/\/api\/login-sessions\/[0-9a-f-]{36}\/screen$/);
  expect(frames[0]).toMatch(/^[0-9a-f]{64}$/);
  expect(await page.content()).not.toContain(frames[0]);

  await done.click();
  await expect(page.getByText("Acme Supply is connected.")).toBeVisible();
  await shot(page, "connect-done", info.project.name);
  await page.getByRole("link", { name: "Back to suppliers" }).click();
  await expect(page.getByRole("row", { name: /Acme Supply/ })).toContainText("Connected");
  expect(problems).toEqual([]); // the viewer and its WebSocket fit the page's security policy
});

test("Cancel closes the window and saves nothing, and a new login can start straight away", async ({ page }) => {
  await signIn(page);
  const supplier = await addViaApi(page);
  await page.goto(supplier.url);
  await expect(liveCanvas(page)).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page).toHaveURL(/\/suppliers$/);
  await expect(page.getByRole("row", { name: /Acme Supply/ })).toContainText("Not connected");
  await page.goto(supplier.url);
  await expect(liveCanvas(page)).toBeVisible({ timeout: 20_000 }); // not refused as a second window
});

test("leaving the connect page, by the menu or by closing the page, cancels the login", async ({ page }) => {
  await signIn(page);
  const supplier = await addViaApi(page);
  await page.goto(supplier.url);
  await expect(liveCanvas(page)).toBeVisible({ timeout: 20_000 });
  await page.goto("/"); // a full page load: the page is closing
  await page.goto(supplier.url);
  await expect(liveCanvas(page)).toBeVisible({ timeout: 20_000 });
  const menu = page.getByRole("button", { name: "Menu" });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Dashboard" }).click(); // moving within the app
  await page.goto(supplier.url);
  await expect(liveCanvas(page)).toBeVisible({ timeout: 20_000 });
});

test("a window that cannot open says so plainly, and Try again works once it can", async ({ page }, info) => {
  await signIn(page);
  const supplier = await addViaApi(page);
  await control.browser({ open: "fail" });
  await page.goto(supplier.url);
  await expect(page.getByRole("alert")).toContainText("The login window could not be opened. Please try again.");
  await expect(liveCanvas(page)).toHaveCount(0);
  await shot(page, "connect-error", info.project.name);
  await control.browser({ open: "ok" });
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(liveCanvas(page)).toBeVisible({ timeout: 20_000 });
});

test("pressing I'm logged in with nothing to save says so, and Try again opens a fresh window", async ({ page }) => {
  await signIn(page);
  const supplier = await addViaApi(page);
  await control.browser({ state: { cookies: [], origins: [] } });
  await page.goto(supplier.url);
  await expect(liveCanvas(page)).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "I'm logged in" }).click();
  await expect(page.getByRole("alert")).toContainText("No login was found in the window.");
  await control.browser({ state: E2E_SESSION });
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(liveCanvas(page)).toBeVisible({ timeout: 20_000 });
});

test("text can be sent to the window, and is cleared from the box afterwards", async ({ page }) => {
  await signIn(page);
  const supplier = await addViaApi(page);
  await page.goto(supplier.url);
  await expect(liveCanvas(page)).toBeVisible({ timeout: 20_000 });
  await page.getByLabel("Paste text").fill("pasted-from-manager");
  await page.getByRole("button", { name: "Send to the window" }).click();
  await expect(page.getByText(/Sent\. Now click the field in the window and press Ctrl\+V\./)).toBeVisible();
  await expect(page.getByLabel("Paste text")).toHaveValue("");
});

test("the connect screen passes the accessibility scan in light and dark, and never scrolls sideways", async ({ page }) => {
  await signIn(page);
  let supplier = await addViaApi(page);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await control.browser({ open: "ok" });
    await page.goto(supplier.url);
    await expect(liveCanvas(page)).toBeVisible({ timeout: 20_000 });
    await scan(page, `${scheme} connect, live window`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${scheme} connect must not scroll sideways`).toBeLessThanOrEqual(0);

    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page).toHaveURL(/\/suppliers$/);
    await control.browser({ open: "fail" });
    await page.goto(supplier.url);
    await expect(page.getByRole("alert")).toBeVisible();
    await scan(page, `${scheme} connect, error`);

    await control.browser({ open: "ok" });
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(liveCanvas(page)).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "I'm logged in" }).click();
    await expect(page.getByText("Acme Supply is connected.")).toBeVisible();
    await scan(page, `${scheme} connect, done`);
    await page.goto("/suppliers");
    await page.getByRole("button", { name: "Delete Acme Supply" }).click();
    await page.getByRole("button", { name: "Yes, delete" }).click();
    supplier = await addViaApi(page);
  }
});

// ---------------------------------------------------------------------------------------------------------
// What happens after a login: the check, the status, the dashboard message and the way back.

/** Opens a supplier's connect screen, waits for the window, presses I'm logged in, and waits for the success message. */
async function connectThroughTheWindow(page: Page, url: string, name = "Acme Supply") {
  await page.goto(url);
  await expect(liveCanvas(page)).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "I'm logged in" }).click();
  await expect(page.getByText(`${name} is connected.`)).toBeVisible();
}
const rowOf = (page: Page, name = "Acme Supply") => page.getByRole("row", { name: new RegExp(name) });
const CHECK_WAIT = { timeout: 30_000 }; // the check runs in the background worker
/** The list does not poll, so a page opened before a background check finished is reloaded until it shows the result. */
const eventually = (page: Page, check: () => Promise<void>) =>
  expect(async () => {
    await page.reload();
    await check();
  }).toPass({ timeout: 30_000, intervals: [1_000, 2_000] });

test("a check that finds the login gone marks only that supplier, raises one message, and Reconnect supplier leads back to a fix", async ({ page }, info) => {
  await signIn(page);
  const acme = await addViaApi(page);
  await addViaApi(page, "Globex");
  await control.browser({ verifyResult: "login_required" });
  await connectThroughTheWindow(page, acme.url);

  await page.goto("/suppliers");
  await eventually(page, () => expect(rowOf(page)).toContainText("Needs reconnecting", { timeout: 1_000 }));
  await expect(rowOf(page, "Globex")).toContainText("Not connected"); // nothing else changed
  await expect(page.getByRole("link", { name: "Reconnect supplier Acme Supply" })).toBeVisible();
  await shot(page, "suppliers-needs-reconnect", info.project.name);

  await page.goto("/");
  const card = page.getByRole("region", { name: "Needs attention" });
  await expect(card.getByRole("listitem")).toHaveCount(1);
  await expect(card).toContainText("Acme Supply needs you to log in again.");
  await shot(page, "dashboard-needs-attention", info.project.name);

  // The login works again: the owner reconnects from the message, and everything clears.
  await control.browser({ verifyResult: "ok" });
  await card.getByRole("link", { name: "Reconnect supplier Acme Supply" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Reconnect Acme Supply" })).toBeVisible();
  await expect(liveCanvas(page)).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "I'm logged in" }).click();
  await expect(page.getByText("Acme Supply is connected.")).toBeVisible();
  await page.goto("/");
  await expect(page.getByText("Nothing needs your attention.")).toBeVisible();
  await page.goto("/suppliers");
  await expect(rowOf(page)).toContainText("Connected");
  await expect(page.getByRole("button", { name: "Pause Acme Supply" })).toBeVisible(); // not left paused
});

test("a puzzle or a block shows as Blocked with its own plain message", async ({ page }) => {
  await signIn(page);
  const supplier = await addViaApi(page);
  await control.browser({ verifyResult: "captcha" });
  await connectThroughTheWindow(page, supplier.url);
  await page.goto("/suppliers");
  await eventually(page, () => expect(rowOf(page)).toContainText("Blocked", { timeout: 1_000 }));
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Needs attention" })).toContainText("is asking you to solve a puzzle (a CAPTCHA)");
});

test("Check connection finds a login that has stopped working", async ({ page }) => {
  await signIn(page);
  const supplier = await addViaApi(page);
  await connectThroughTheWindow(page, supplier.url);
  await page.goto("/suppliers");
  await expect(rowOf(page)).toContainText("Connected");
  await control.browser({ verifyResult: "blocked" });
  await page.getByRole("button", { name: "Check connection Acme Supply" }).click();
  await expect(page.getByText("A check of Acme Supply has started.")).toBeVisible();
  await expect(rowOf(page)).toContainText("Blocked", CHECK_WAIT); // the list reads itself again, no reload
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Needs attention" })).toContainText("is blocking access");
});

test("a supplier that is not connected offers Connect, and a connected one offers Check connection", async ({ page }) => {
  await signIn(page);
  const supplier = await addViaApi(page);
  await page.goto("/suppliers");
  await expect(page.getByRole("link", { name: "Connect Acme Supply" })).toHaveAttribute("href", supplier.url);
  await page.getByRole("link", { name: "Connect Acme Supply" }).click();
  await expect(liveCanvas(page)).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "I'm logged in" }).click();
  await expect(page.getByText("Acme Supply is connected.")).toBeVisible();
  await page.getByRole("link", { name: "Back to suppliers" }).click();
  await expect(page.getByRole("button", { name: "Check connection Acme Supply" })).toBeVisible();
});

test("the dashboard and the supplier actions pass the accessibility scan in light and dark, and never scroll sideways", async ({ page }, info) => {
  await signIn(page);
  const supplier = await addViaApi(page);
  await addViaApi(page, "Globex");
  await control.browser({ verifyResult: "login_required" });
  await connectThroughTheWindow(page, supplier.url);
  await page.goto("/suppliers");
  await eventually(page, () => expect(rowOf(page)).toContainText("Needs reconnecting", { timeout: 1_000 }));
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const path of ["/", "/suppliers"]) {
      await page.goto(path);
      await expect(path === "/" ? page.getByRole("region", { name: "Needs attention" }).getByRole("listitem") : rowOf(page)).toBeVisible();
      await scan(page, `${scheme} ${path}`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${scheme} ${path} must not scroll sideways`).toBeLessThanOrEqual(0);
      await shot(page, `${path === "/" ? "dashboard" : "suppliers"}-${scheme}`, info.project.name);
    }
  }
});
