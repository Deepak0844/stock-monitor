import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

type Seen = { sections: { heading: string | null; lines: string[] }[]; buttons: { label: string }[] };
let seen: Record<string, Seen>;

beforeAll(() => {
  const probe = fileURLToPath(new URL("./consent-probe.ts", import.meta.url));
  const out = execFileSync("node", ["--import", "tsx", probe], { encoding: "utf8", timeout: 60_000 });
  seen = JSON.parse(out.trim().split("\n").pop() as string);
}, 90_000);

const headings = (s: Seen) => s.sections.map((x) => x.heading);
const labels = (s: Seen) => s.buttons.map((b) => b.label);

describe("cookie banners are left out of a captured page", () => {
  it("a Cookiebot dialog gives no section and no button", () => {
    expect(headings(seen.cookiebot as Seen)).toEqual(["Blue widget"]);
    expect(labels(seen.cookiebot as Seen)).toEqual(["Add to cart"]);
  });
  it("a banner from a tool we do not know is found by what it is", () => {
    expect(headings(seen.unknown as Seen)).toEqual(["Blue widget"]);
    expect(labels(seen.unknown as Seen)).toEqual(["Add to cart"]);
  });
  it("a shop that sells cookies keeps its own page", () => {
    const s = seen.cookieShop as Seen;
    expect(headings(s)).toEqual(["Chocolate cookies"]);
    expect(s.sections[0]?.lines).toContain("A box of 12 cookies");
    expect(labels(s)).toEqual(["Add to cart"]);
  });
  it("a fixed panel that is not about cookies stays", () => {
    const s = seen.cartDrawer as Seen;
    expect(headings(s)).toContain("Your basket");
    expect(labels(s)).toContain("Checkout");
  });
});
