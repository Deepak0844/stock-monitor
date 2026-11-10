// tsx (how the container runs the service) wraps named inner functions in __name(), which is not defined inside the page.
// vitest does not, so only a run under tsx can catch it.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("readPage under tsx", () => {
  it("reads headings, text and buttons from a real page", () => {
    const probe = fileURLToPath(new URL("./read-page-probe.ts", import.meta.url));
    const out = execFileSync("node", ["--import", "tsx", probe], {
      encoding: "utf8",
      timeout: 60_000,
    });
    const seen = JSON.parse(out.trim().split("\n").pop() as string);
    expect(
      seen.sections.some(
        (s: { heading: string | null; lines: string[] }) =>
          s.heading === "Blue widget" && s.lines.includes("Out of stock"),
      ),
    ).toBe(true);
    expect(seen.buttons).toEqual([
      { label: "Add to cart", enabled: false, section: "Blue widget" },
    ]);
  }, 90_000);
});
