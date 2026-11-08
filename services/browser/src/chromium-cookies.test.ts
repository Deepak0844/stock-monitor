import { createCipheriv, createHash, pbkdf2Sync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptCookieValue, readCookies } from "./chromium-cookies.js";

// What Chromium does on Linux with its simplest password store: AES-128-CBC with a fixed, well-known key.
const key = pbkdf2Sync("peanuts", "saltysalt", 1, 16, "sha1");
const encrypt = (plain: Buffer) => {
  const cipher = createCipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
  return Buffer.concat([Buffer.from("v10"), cipher.update(plain), cipher.final()]);
};
const sha256 = (s: string) => createHash("sha256").update(s).digest();
const WINDOWS_EPOCH_SECONDS = 11_644_473_600;

describe("decryptCookieValue", () => {
  it("reads a value Chromium encrypted", () => {
    expect(decryptCookieValue(encrypt(Buffer.from("abc123")), ".shop.example")).toBe("abc123");
  });
  it("drops the 32-byte fingerprint of the domain that newer Chromium puts in front of the value", () => {
    const host = ".shop.example";
    expect(
      decryptCookieValue(encrypt(Buffer.concat([sha256(host), Buffer.from("abc123")])), host),
    ).toBe("abc123");
  });
  it("keeps a value that merely starts with 32 bytes that are not that domain's fingerprint", () => {
    const value = "x".repeat(40);
    expect(decryptCookieValue(encrypt(Buffer.from(value)), ".shop.example")).toBe(value);
  });
  it("passes through a value that was not encrypted", () => {
    expect(decryptCookieValue(Buffer.from("plain-value"), ".shop.example")).toBe("plain-value");
  });
  it("reads an empty value", () => {
    expect(decryptCookieValue(Buffer.alloc(0), ".shop.example")).toBe("");
  });
  it("refuses damaged data and a scheme it does not know, rather than returning rubbish", () => {
    expect(() =>
      decryptCookieValue(
        Buffer.concat([Buffer.from("v10"), Buffer.from("not a multiple of sixteen")]),
        ".a.example",
      ),
    ).toThrow();
    expect(() =>
      decryptCookieValue(Buffer.concat([Buffer.from("v11"), Buffer.alloc(32)]), ".a.example"),
    ).toThrow(/not supported/);
  });
});

describe("readCookies", () => {
  let dir = "";
  let db: DatabaseSync;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cookies-test-"));
    db = new DatabaseSync(join(dir, "Cookies"));
    db.exec(
      `create table cookies (host_key text, name text, value text, encrypted_value blob, path text, expires_utc integer, is_secure integer, is_httponly integer, has_expires integer, is_persistent integer, samesite integer)`,
    );
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const add = (
    row: Partial<{
      host: string;
      name: string;
      value: string;
      enc: Buffer;
      path: string;
      expires: number;
      secure: number;
      httponly: number;
      persistent: number;
      samesite: number;
    }>,
  ) =>
    db
      .prepare("insert into cookies values (?,?,?,?,?,?,?,?,?,?,?)")
      .run(
        row.host ?? ".shop.example",
        row.name ?? "c",
        row.value ?? "",
        row.enc ?? Buffer.alloc(0),
        row.path ?? "/",
        row.expires ?? 0,
        row.secure ?? 0,
        row.httponly ?? 0,
        row.persistent ? 1 : 0,
        row.persistent ? 1 : 0,
        row.samesite ?? -1,
      );

  it("returns each cookie in the shape the rest of the app stores, decrypted", () => {
    const unixSeconds = 1_800_000_000;
    add({
      name: "session",
      enc: encrypt(Buffer.concat([sha256(".shop.example"), Buffer.from("S3CR3T")])),
      expires: (unixSeconds + WINDOWS_EPOCH_SECONDS) * 1_000_000,
      secure: 1,
      httponly: 1,
      persistent: 1,
      samesite: 1,
      path: "/account",
    });
    db.close();
    db = new DatabaseSync(join(dir, "Cookies"));
    expect(readCookies(join(dir, "Cookies"))).toEqual([
      {
        name: "session",
        value: "S3CR3T",
        domain: ".shop.example",
        path: "/account",
        expires: unixSeconds,
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
    ]);
  });

  it("marks a cookie with no expiry as a session cookie", () => {
    add({ name: "s", enc: encrypt(Buffer.from("v")) });
    expect(readCookies(join(dir, "Cookies"))[0]).toMatchObject({ name: "s", expires: -1 });
  });

  it.each([
    [-1, "Lax"],
    [0, "None"],
    [1, "Lax"],
    [2, "Strict"],
  ])("reads same-site %i as %s", (samesite, word) => {
    add({ name: "x", enc: encrypt(Buffer.from("v")), samesite });
    expect(readCookies(join(dir, "Cookies"))[0]?.sameSite).toBe(word);
  });

  it("uses the plain value column when there is no encrypted value", () => {
    add({ name: "p", value: "visible" });
    expect(readCookies(join(dir, "Cookies"))[0]?.value).toBe("visible");
  });

  it("returns an empty list for a store with no cookies", () => {
    expect(readCookies(join(dir, "Cookies"))).toEqual([]);
  });

  it("skips one cookie it cannot read, and says so plainly when it can read none of several", () => {
    add({ name: "good", enc: encrypt(Buffer.from("ok")) });
    add({ name: "bad", enc: Buffer.concat([Buffer.from("v10"), Buffer.from("garbage")]) });
    expect(readCookies(join(dir, "Cookies")).map((c) => c.name)).toEqual(["good"]);
    db.exec("delete from cookies where name = 'good'");
    expect(() => readCookies(join(dir, "Cookies"))).toThrow(/could not be read/);
  });

  it("does not change the file, and a missing file is a plain error", () => {
    add({ name: "a", enc: encrypt(Buffer.from("v")) });
    readCookies(join(dir, "Cookies"));
    expect((db.prepare("select count(*) as n from cookies").get() as { n: number }).n).toBe(1);
    expect(() => readCookies(join(dir, "missing"))).toThrow(/no cookie store/i);
  });
});
