import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { startTestDb, type TestDb } from "@stock-monitor/db/test-harness";

let t: TestDb;
beforeAll(async () => {
  t = await startTestDb();
}, 180_000);
afterAll(async () => {
  await t?.stop();
});

const cwd = fileURLToPath(new URL("..", import.meta.url));

function runCli(input: string): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn("node", ["--import", "tsx", "src/cli/create-owner.ts"], {
      cwd,
      env: { ...process.env, DATABASE_URL: t.appUrl },
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code, out }));
    child.stdin.end(input);
  });
}

describe("create-owner command", () => {
  it("fails when the two passwords differ and creates nothing", async () => {
    const { code, out } = await runCli("a@example.com\nfirst-password-123\nsecond-password-456\n");
    expect(code).toBe(1);
    expect(out).toMatch(/passwords do not match/i);
    const { rows } = await t.pool.query("select count(*)::int as n from users");
    expect(rows[0].n).toBe(0);
  }, 60_000);

  it("creates the owner from piped input and never echoes the password", async () => {
    const { code, out } = await runCli("Owner@Example.com\ncorrect-horse-battery\ncorrect-horse-battery\n");
    expect(code).toBe(0);
    expect(out).toMatch(/owner account created/i);
    expect(out).not.toContain("correct-horse-battery");
    const { rows } = await t.pool.query("select email from users");
    expect(rows.map((r) => r.email)).toEqual(["owner@example.com"]);
  }, 60_000);

  it("refuses a second owner", async () => {
    const { code, out } = await runCli("two@example.com\ncorrect-horse-battery\ncorrect-horse-battery\n");
    expect(code).toBe(1);
    expect(out).toMatch(/already exists/i);
  }, 60_000);
});
