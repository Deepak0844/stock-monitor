import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chromeBrands, parseChromeVersion, secChUa, writeDisguise } from "./disguise.js";

describe("chromeBrands", () => {
  it("lists the brands in the order real Google Chrome 157 sends them", () => {
    expect(chromeBrands("157.0.8103.79")).toEqual([
      { brand: "Not-A.Brand", version: "99.0.0.0" },
      { brand: "Google Chrome", version: "157.0.8103.79" },
      { brand: "Chromium", version: "157.0.8103.79" },
    ]);
  });
});

describe("secChUa", () => {
  it("matches the header real Google Chrome 157 sends", () => {
    expect(secChUa("157.0.8103.79")).toBe('"Not-A.Brand";v="99", "Google Chrome";v="157", "Chromium";v="157"');
  });

  it("follows the same rule for 158", () => {
    expect(secChUa("158.0.8127.18")).toBe('"Chromium";v="158", "Not.A/Brand";v="24", "Google Chrome";v="158"');
  });
});

describe("parseChromeVersion", () => {
  it("reads the version from the browser's --version line", () => {
    expect(parseChromeVersion("Google Chrome for Testing 158.0.8127.18\n")).toBe("158.0.8127.18");
  });

  it("gives null for anything else", () => {
    expect(parseChromeVersion("garbage")).toBeNull();
  });
});

describe("writeDisguise", () => {
  it("writes an extension that runs in the page's world, before its scripts, in every frame", async () => {
    const dir = await mkdtemp(join(tmpdir(), "disguise-test-"));
    try {
      await writeDisguise(dir, "158.0.8127.18");
      const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8"));
      expect(manifest.manifest_version).toBe(3);
      expect(manifest.content_scripts).toEqual([
        expect.objectContaining({ js: ["page.js"], world: "MAIN", all_frames: true, match_origin_as_fallback: true, run_at: "document_start" }),
      ]);
      const rules = JSON.parse(await readFile(join(dir, "rules.json"), "utf8"));
      expect(rules[0].action.requestHeaders).toEqual([{ header: "sec-ch-ua", operation: "set", value: secChUa("158.0.8127.18") }]);
      const page = await readFile(join(dir, "page.js"), "utf8");
      expect(page.startsWith(`const FULL = ${JSON.stringify(chromeBrands("158.0.8127.18"))};`)).toBe(true);
      expect(page).toContain("UHD Graphics 620");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
