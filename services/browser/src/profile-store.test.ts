import { existsSync, lstatSync } from "node:fs";
import { mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clearStaleLocks, cookieHash, holdProfile, isHeld, profileDirFor, releaseProfile } from "./profile-store.js";

describe("profileDirFor", () => {
  it("gives one folder per site, whatever the page or query", () => {
    const a = profileDirFor("/base", "https://shop.acme.example/account/login?x=1");
    expect(a).toBe(profileDirFor("/base", "https://shop.acme.example/products/blue"));
    expect(a).not.toBe(profileDirFor("/base", "https://other.example/"));
    expect(a.startsWith("/base/")).toBe(true);
  });
  it("never lets the address choose the folder name", () => {
    expect(profileDirFor("/base", "https://a.example/../../etc")).toMatch(/^\/base\/[0-9a-f]{16}$/);
  });
});

describe("cookieHash", () => {
  it("changes when a cookie changes, and not otherwise", () => {
    const c = [{ name: "a", value: "1" }];
    expect(cookieHash(c)).toBe(cookieHash([{ name: "a", value: "1" }]));
    expect(cookieHash(c)).not.toBe(cookieHash([{ name: "a", value: "2" }]));
  });
});

describe("holding a profile", () => {
  it("lets one holder have a profile at a time, and frees it when released", () => {
    expect(isHeld("/p")).toBe(false);
    expect(holdProfile("/p")).toBe(true);
    expect(isHeld("/p")).toBe(true);
    expect(holdProfile("/p")).toBe(false);
    releaseProfile("/p");
    expect(holdProfile("/p")).toBe(true);
    releaseProfile("/p");
  });
});

describe("clearStaleLocks", () => {
  it("removes Chromium's lock files, even ones that point at another machine, and nothing else", async () => {
    const dir = await mkdtemp(join(tmpdir(), "locks-"));
    try {
      await symlink("other-host-1", join(dir, "SingletonLock")); // dangling, as a recreated container leaves it
      await symlink("/tmp/gone/socket", join(dir, "SingletonSocket"));
      await writeFile(join(dir, "SingletonCookie"), "x");
      await writeFile(join(dir, "seeded"), "hash");
      await clearStaleLocks(dir);
      expect(await readdir(dir)).toEqual(["seeded"]);
      expect(() => lstatSync(join(dir, "SingletonLock"))).toThrow();
      await clearStaleLocks(dir); // nothing left to remove
      expect(existsSync(join(dir, "seeded"))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
