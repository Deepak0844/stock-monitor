import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { driverFor } from "./driver.js";

describe("driverFor", () => {
  it("is plain Playwright unless stealth is asked for", async () => {
    expect(await driverFor(false)).toBe(chromium);
  });
  it("is Patchright's Chromium driver when stealth is on, and the same one every time", async () => {
    const stealth = await driverFor(true);
    expect(stealth).not.toBe(chromium);
    expect(typeof stealth.connectOverCDP).toBe("function");
    expect(await driverFor(true)).toBe(stealth);
  });
});
