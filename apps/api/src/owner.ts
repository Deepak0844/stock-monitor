import { hash } from "@node-rs/argon2";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { users } from "@stock-monitor/db";
import { createAuditWriter } from "@stock-monitor/audit";

const input = z.object({
  email: z.email("Enter a valid email address.").transform((e) => e.trim().toLowerCase()),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

export async function createOwner<S extends Record<string, unknown>>(
  db: NodePgDatabase<S>,
  raw: { email: string; password: string },
): Promise<void> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid input.");
  const { email, password } = parsed.data;

  const [existing] = await db.select({ count: sql<number>`count(*)::int` }).from(users);
  if ((existing?.count ?? 0) > 0) throw new Error("An owner account already exists.");

  const [owner] = await db
    .insert(users)
    .values({ email, passwordHash: await hash(password) })
    .returning({ id: users.id });
  await createAuditWriter(db).record({
    action: "owner.created",
    entityType: "user",
    entityId: owner?.id,
  });
}
