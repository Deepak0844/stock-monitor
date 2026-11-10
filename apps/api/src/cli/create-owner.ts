import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { createOwner } from "../owner.js";

// One reader for the whole session. A new reader per prompt loses piped input.
function createPrompter() {
  let muted = false;
  const out = new Writable({
    write(chunk, encoding, done) {
      if (!muted) process.stdout.write(chunk, encoding);
      done();
    },
  });
  const rl = createInterface({ input: process.stdin, output: out, terminal: process.stdin.isTTY === true });
  const lines = rl[Symbol.asyncIterator]();
  return {
    async ask(question: string, hidden: boolean): Promise<string> {
      process.stdout.write(question);
      muted = hidden;
      const next = await lines.next();
      muted = false;
      if (hidden) process.stdout.write("\n");
      if (next.done) throw new Error("No input received.");
      return next.value;
    },
    close: () => rl.close(),
  };
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");

  const prompt = createPrompter();
  let email: string, password: string, repeat: string;
  try {
    email = await prompt.ask("Owner email: ", false);
    password = await prompt.ask("Password (min 12 characters): ", true);
    repeat = await prompt.ask("Repeat password: ", true);
  } finally {
    prompt.close();
  }
  if (password !== repeat) throw new Error("Passwords do not match.");

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
