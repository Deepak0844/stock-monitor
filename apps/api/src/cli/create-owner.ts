import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { createOwner } from "../owner.js";

function ask(question: string, hidden: boolean): Promise<string> {
  let muted = false;
  const out = new Writable({
    write(chunk, encoding, done) {
      if (!muted) process.stdout.write(chunk, encoding);
      done();
    },
  });
  const rl = createInterface({ input: process.stdin, output: out, terminal: true });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer);
    });
    muted = hidden;
  });
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");

  const email = await ask("Owner email: ", false);
  const password = await ask("Password (min 12 characters): ", true);
  if (password !== (await ask("Repeat password: ", true))) throw new Error("Passwords do not match.");

  const pool = new pg.Pool({ connectionString: url });
  try {
    await createOwner(drizzle(pool), { email, password });
    console.log("Owner account created.");
  } finally {
    await pool.end();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : "Could not create the owner account.");
  process.exit(1);
});
