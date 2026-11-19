import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

type Seen = { before: number; after: number; settled: boolean; ms: number };
let seen: Record<string, Seen>;

beforeAll(() => {
  const probe = fileURLToPath(new URL("./settle-probe.ts", import.meta.url));
  seen = JSON.parse((execFileSync("node", ["--import", "tsx", probe], { encoding: "utf8", timeout: 60_000 }).trim().split("\n").pop()) as string);
}, 90_000);

describe("waiting for a page that fades in", () => {
  it("waits until the main heading is really shown, so the picture is not blank", () => {
    const s = seen.FADES_IN as Seen;
    expect(s.before).toBe(0);
    expect(s.after).toBeGreaterThanOrEqual(0.99);
    expect(s.settled).toBe(true);
  });
  it("does not wait on a page that is already shown", () => {
    const s = seen.PLAIN as Seen;
    expect(s).toMatchObject({ before: 1, after: 1, settled: true });
    expect(s.ms).toBeLessThan(500);
  });
  it("gives up at the limit when the page never shows, and says so", () => {
    const s = seen.NEVER as Seen;
    expect(s.settled).toBe(false);
    expect(s.ms).toBeGreaterThanOrEqual(550);
    expect(s.ms).toBeLessThan(2000);
  });
  it("does not wait on a page with no heading", () => {
    expect(seen.NO_HEADING).toMatchObject({ settled: true });
    expect((seen.NO_HEADING as Seen).ms).toBeLessThan(500);
  });
});
