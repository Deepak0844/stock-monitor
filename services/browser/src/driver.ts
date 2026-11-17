import { chromium } from "playwright";

type Driver = typeof chromium;
let stealthDriver: Promise<Driver> | undefined;

/**
 * The driver that attaches to a browser the service started. Plain Playwright unless the supplier has the stealth switch on.
 * Patchright is Playwright's Chromium driver without the usual signs of automation (the Runtime.enable leak, automation
 * switches). It only replaces the attaching side: the browser is still the same Chromium, started the same way, under the
 * same sandbox. Loaded the first time it is needed, so a service with no stealth supplier never reads it.
 */
export function driverFor(stealth: boolean): Promise<Driver> {
  if (!stealth) return Promise.resolve(chromium);
  stealthDriver ??= import("patchright").then((m) => m.chromium as unknown as Driver);
  return stealthDriver;
}
