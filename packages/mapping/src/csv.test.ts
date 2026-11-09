import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv.js";

const parse = (text: string) => {
  const r = parseCsv(text);
  if (!r.ok) throw new Error(r.message);
  return r;
};

describe("parseCsv", () => {
  it("reads a header and rows", () => {
    expect(parse("a,b\n1,2\n3,4\n")).toEqual({ ok: true, header: ["a", "b"], rows: [["1", "2"], ["3", "4"]] });
  });

  it("keeps commas and line breaks inside quoted cells, and doubled quotes", () => {
    const r = parse('a,b\n"x, y","line1\nline2 ""q"""\n');
    expect(r.rows).toEqual([["x, y", 'line1\nline2 "q"']]);
  });

  it("handles a byte order mark and Windows line endings", () => {
    const r = parse("﻿a,b\r\n1,2\r\n");
    expect(r.header).toEqual(["a", "b"]);
    expect(r.rows).toEqual([["1", "2"]]);
  });

  it("returns cells that look like formulas as plain unchanged text", () => {
    expect(parse("a\n=1+1\n+x\n-y\n@z\n").rows).toEqual([["=1+1"], ["+x"], ["-y"], ["@z"]]);
  });

  it("refuses a file over the size limit with a plain message", () => {
    const r = parseCsv("a\n" + "x".repeat(50), { maxBytes: 10, maxRows: 100 });
    expect(r).toEqual({ ok: false, message: expect.stringContaining("too big") });
  });

  it("refuses a file over the row limit", () => {
    const r = parseCsv("a\n1\n2\n3\n", { maxBytes: 1000, maxRows: 2 });
    expect(r).toEqual({ ok: false, message: expect.stringContaining("too many rows") });
  });

  it("refuses an empty file and an unfinished quote", () => {
    expect(parseCsv("")).toMatchObject({ ok: false });
    expect(parseCsv('a\n"open')).toMatchObject({ ok: false, message: expect.stringContaining("quote") });
  });

  it("skips blank lines", () => {
    expect(parse("a\n\n1\n\n").rows).toEqual([["1"]]);
  });
});
