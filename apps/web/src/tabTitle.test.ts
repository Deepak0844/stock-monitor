// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { resetTabTitleForTests, setPageTitle, setWaiting } from "./tabTitle.js";

const icon = () => document.querySelector<HTMLLinkElement>('link[rel="icon"]')?.getAttribute("href") ?? "";

beforeEach(() => {
  document.head.innerHTML = '<link rel="icon" type="image/svg+xml" href="/favicon.svg" />';
  resetTabTitleForTests();
});

describe("browser tab", () => {
  it("shows how many proposals are waiting before the page name", () => {
    setPageTitle("Proposals");
    setWaiting(12, false);
    expect(document.title).toBe("(12) Proposals · Stock Monitor");
    expect(icon()).toMatch(/favicon-alert\.svg$/);
  });

  it("shows no count and the plain icon when nothing is waiting", () => {
    setPageTitle("Proposals");
    setWaiting(0, false);
    expect(document.title).toBe("Proposals · Stock Monitor");
    expect(icon()).toMatch(/\/favicon\.svg$/);
  });

  it("dots the icon when something needs the owner, even with no proposals", () => {
    setPageTitle("Dashboard");
    setWaiting(0, true);
    expect(document.title).toBe("Dashboard · Stock Monitor");
    expect(icon()).toMatch(/favicon-alert\.svg$/);
  });

  it("keeps the count when the owner moves to another page", () => {
    setWaiting(3, false);
    setPageTitle("Suppliers");
    expect(document.title).toBe("(3) Suppliers · Stock Monitor");
  });
});
