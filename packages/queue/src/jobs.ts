import { z } from "zod";

// Every background job is declared here with the shape of its payload.
export const jobSchemas = {
  "health.ping": z.object({ message: z.string().min(1) }),
  // No data at all: the worker reads everything it needs from the database. Strict, so a secret
  // can never be added to a job by mistake.
  "shopify.sync": z.object({}).strict(),
  // Which supplier to check, and nothing else. The worker reads the saved session from the database, so no
  // session, cookie or token is ever in a job.
  "supplier.session.verify": z.object({ supplierId: z.uuid() }).strict(),
  // Which link to check, and nothing else. A run for a whole supplier is just the supplier's id. The worker reads the
  // saved session and the address from the database, so no session, cookie or address is ever in a job.
  // Stock rules. Ids only: the worker reads the saved session, the address and the recipe from the database.
  "extraction.capture": z.object({ captureId: z.uuid() }).strict(),
  "extraction.check": z.object({ mappingId: z.uuid() }).strict(),
  "extraction.checks": z.object({ supplierId: z.uuid() }).strict(),
  "mapping.link.check": z.object({ mappingId: z.uuid() }).strict(),
  "mapping.links.check": z.object({ supplierId: z.uuid() }).strict(),
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
