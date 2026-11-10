// Shopify is read-only except for one file. This fails if any non-test source file other than
// packages/shopify/src/inventory-write.ts contains a GraphQL mutation or names one of Shopify's write
// operations, and if that one file does anything but set the `available` quantity.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../..", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "node_modules" || name === "dist" || name === "test" || name === "drizzle") return [];
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !/\.d\.ts$/.test(name) ? [path] : [];
  });
}

const WRITER = "packages/shopify/src/inventory-write.ts";
const allFiles = [...sourceFiles(join(root, "packages")), ...sourceFiles(join(root, "apps"))];
const files = allFiles.filter((f) => relative(root, f) !== WRITER);

// A GraphQL mutation operation: the keyword followed by an optional name and then ( or {.
const MUTATION = /\bmutation\s+[A-Za-z_]*\s*[({]/;
const WRITE_OPERATIONS = /\b(inventorySetQuantities|inventoryAdjustQuantities|inventorySetOnHandQuantities|inventoryActivate|inventoryDeactivate|productUpdate|productVariantsBulkUpdate)\b/;

const WRITE_OPERATIONS_GLOBAL = new RegExp(WRITE_OPERATIONS.source, "g");

describe("Shopify is read-only except the one stock write", () => {
  it("scans a real set of source files", () => {
    expect(files.length).toBeGreaterThan(30);
    expect(files.some((f) => f.endsWith("packages/shopify/src/client.ts"))).toBe(true);
    expect(files.some((f) => f.endsWith("inventory-write.ts"))).toBe(false); // the one writer is checked on its own below
  });

  it("contains no GraphQL mutation", () => {
    const offenders = files.filter((f) => MUTATION.test(readFileSync(f, "utf8"))).map((f) => relative(root, f));
    expect(offenders).toEqual([]);
  });

  it("does not name any Shopify write operation", () => {
    const offenders = files.filter((f) => WRITE_OPERATIONS.test(readFileSync(f, "utf8"))).map((f) => relative(root, f));
    expect(offenders).toEqual([]);
  });

  it("the one writer exists and only sets available stock", () => {
    const writer = allFiles.find((f) => relative(root, f) === WRITER);
    expect(writer).toBeDefined();
    const text = readFileSync(writer!, "utf8");
    expect(text.match(/\bmutation\s+\w*\s*[({]/g)).toHaveLength(1);
    expect(text.match(WRITE_OPERATIONS_GLOBAL)?.every((m) => m === "inventorySetQuantities")).toBe(true);
    expect(text).toContain('name: "available"');
    expect(text).not.toMatch(/inventoryAdjustQuantities|inventorySetOnHandQuantities|inventoryActivate|inventoryDeactivate|productUpdate|productVariantsBulkUpdate/);
  });

  it("recognises a mutation when there is one", () => {
    expect(MUTATION.test("const q = `mutation SetStock($id: ID!) { x }`;")).toBe(true);
    expect(MUTATION.test("mutation { x }")).toBe(true);
    expect(MUTATION.test("// there is no mutation anywhere in this package")).toBe(false);
    expect(WRITE_OPERATIONS.test("inventorySetQuantities(input: $input)")).toBe(true);
  });
});
