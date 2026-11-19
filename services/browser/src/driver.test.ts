import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { driverFor, isUtcName } from "./driver.js";

describe("isUtcName", () => {
  it("knows every name for UTC, and no real place", () => {
    for (const n of ["UTC", "Etc/UTC", "GMT", "Zulu", "Etc/GMT"]) expect(isUtcName(n)).toBe(true);
    for (const n of ["Asia/Kolkata", "Europe/London", "America/New_York"]) expect(isUtcName(n)).toBe(false);
  });
});

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
