import { z } from "zod";

// Every background job is declared here with the shape of its payload.
export const jobSchemas = {
  "health.ping": z.object({ message: z.string().min(1) }),
  // No data at all: the worker reads everything it needs from the database. Strict, so a secret
  // can never be added to a job by mistake.
  "shopify.sync": z.object({}).strict(),
} as const;

export type JobName = keyof typeof jobSchemas;
export type JobPayload<N extends JobName> = z.infer<(typeof jobSchemas)[N]>;

export function parseJob<N extends JobName>(name: N, payload: unknown): JobPayload<N> {
  const schema = jobSchemas[name];
  if (!schema) throw new Error(`Unknown job: ${String(name)}`);
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(`Invalid payload for ${name}: ${parsed.error.issues[0]?.message ?? "invalid"}`);
  }
  return parsed.data as JobPayload<N>;
}
