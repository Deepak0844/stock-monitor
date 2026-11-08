// Phase A is read-only. This fails if any non-test source file contains a GraphQL mutation or
// names one of Shopify's inventory write operations.
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

const files = [...sourceFiles(join(root, "packages")), ...sourceFiles(join(root, "apps"))];

// A GraphQL mutation operation: the keyword followed by an optional name and then ( or {.
const MUTATION = /\bmutation\s+[A-Za-z_]*\s*[({]/;
const WRITE_OPERATIONS = /\b(inventorySetQuantities|inventoryAdjustQuantities|inventorySetOnHandQuantities|inventoryActivate|inventoryDeactivate|productUpdate|productVariantsBulkUpdate)\b/;

describe("Phase A is read-only", () => {
  it("scans a real set of source files", () => {
    expect(files.length).toBeGreaterThan(30);
    expect(files.some((f) => f.endsWith("packages/shopify/src/client.ts"))).toBe(true);
  });

  it("contains no GraphQL mutation", () => {
    const offenders = files.filter((f) => MUTATION.test(readFileSync(f, "utf8"))).map((f) => relative(root, f));
    expect(offenders).toEqual([]);
  });

  it("does not name any Shopify write operation", () => {
    const offenders = files.filter((f) => WRITE_OPERATIONS.test(readFileSync(f, "utf8"))).map((f) => relative(root, f));
    expect(offenders).toEqual([]);
  });

  it("recognises a mutation when there is one", () => {
    expect(MUTATION.test("const q = `mutation SetStock($id: ID!) { x }`;")).toBe(true);
    expect(MUTATION.test("mutation { x }")).toBe(true);
    expect(MUTATION.test("// there is no mutation anywhere in this package")).toBe(false);
    expect(WRITE_OPERATIONS.test("inventorySetQuantities(input: $input)")).toBe(true);
  });
});
