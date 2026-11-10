import { defineConfig, devices } from "@playwright/test";
import { BASE_URL } from "./e2e/constants.js";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: BASE_URL, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", testIgnore: /(mappings|extraction|scheduling|proposals)\.spec/, use: { ...devices["Desktop Chrome"] } },
    // The phone run starts after the desktop run has finished. The Shopify tests share one connection
    // and one fake store, so the two sizes must not run at the same time.
    { name: "phone", testIgnore: /(mappings|extraction|scheduling|proposals)\.spec/, use: { ...devices["Pixel 7"] }, dependencies: ["desktop"] },
    // The link journeys reset the suppliers and the variants, which the journeys above also use, so they run on their own, after them.
    { name: "mappings-desktop", testMatch: /mappings\.spec/, use: { ...devices["Desktop Chrome"] }, dependencies: ["phone"] },
    { name: "mappings-phone", testMatch: /mappings\.spec/, use: { ...devices["Pixel 7"] }, dependencies: ["mappings-desktop"] },
    // The stock rule journeys also reset the suppliers and variants, so they run last, one after another.
    { name: "extraction-desktop", testMatch: /extraction\.spec/, use: { ...devices["Desktop Chrome"] }, dependencies: ["mappings-phone"] },
    { name: "extraction-phone", testMatch: /extraction\.spec/, use: { ...devices["Pixel 7"] }, dependencies: ["extraction-desktop"] },
    // The automatic check journeys also reset the suppliers and variants, so they run last, one after another.
    { name: "scheduling-desktop", testMatch: /scheduling\.spec/, use: { ...devices["Desktop Chrome"] }, dependencies: ["extraction-phone"] },
    { name: "scheduling-phone", testMatch: /scheduling\.spec/, use: { ...devices["Pixel 7"] }, dependencies: ["scheduling-desktop"] },
    // The suggestion journeys reset the suppliers, variants and the Shopify connection, so they run last, one after another.
    { name: "proposals-desktop", testMatch: /proposals\.spec/, use: { ...devices["Desktop Chrome"] }, dependencies: ["scheduling-phone"] },
    { name: "proposals-phone", testMatch: /proposals\.spec/, use: { ...devices["Pixel 7"] }, dependencies: ["proposals-desktop"] },
  ],
  webServer: {
    command: "npx tsx e2e/stack.ts",
    url: `${BASE_URL}/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    gracefulShutdown: { signal: "SIGTERM", timeout: 20_000 },
  },
});
