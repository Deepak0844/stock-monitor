import { and, asc, count, desc, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { pageCaptures } from "./schema.js";

export type ExpectedAnswer = "in_stock" | "out_of_stock" | "cannot_tell";
/** What the app keeps about a capture without its text or picture. */
export type CaptureSummary = {
  id: string;
  supplierId: string;
  mappingId: string | null;
  name: string;
  expectedAnswer: ExpectedAnswer | null;
  status: "pending" | "ready" | "failed";
  failureReason: string | null;
  pageClass: string | null;
  keptReason: "example" | "page_changed";
  createdAt: Date;
  hasPicture: boolean;
};
export type CaptureRecord = CaptureSummary & { description: unknown };
export type CaptureFill =
  | { status: "ready"; pageClass: string; description: unknown; picture: Buffer | null }
  | { status: "failed"; failureReason: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PER_SUPPLIER = 50;
const MAX_CHANGED_PER_LINK = 3;

const summaryColumns = {
  id: pageCaptures.id,
  supplierId: pageCaptures.supplierId,
  mappingId: pageCaptures.mappingId,
  name: pageCaptures.name,
  expectedAnswer: pageCaptures.expectedAnswer,
  status: pageCaptures.status,
  failureReason: pageCaptures.failureReason,
  pageClass: pageCaptures.pageClass,
  keptReason: pageCaptures.keptReason,
  createdAt: pageCaptures.createdAt,
  hasPicture: sql<boolean>`${pageCaptures.picture} is not null`,
};

export function createCaptureRepository<S extends Record<string, unknown>>(db: NodePgDatabase<S>) {
  const get = async (id: string): Promise<CaptureRecord | null> => {
    if (!UUID.test(id)) return null;
    const [row] = await db.select({ ...summaryColumns, description: pageCaptures.description }).from(pageCaptures).where(eq(pageCaptures.id, id)).limit(1);
    return (row as CaptureRecord | undefined) ?? null;
  };

  /** Keeps a supplier to 50 captures by removing the oldest unlabelled ones. Labelled examples are never removed. */
  async function trim(supplierId: string): Promise<void> {
    const [{ total } = { total: 0 }] = await db.select({ total: count() }).from(pageCaptures).where(eq(pageCaptures.supplierId, supplierId));
    if (total <= MAX_PER_SUPPLIER) return;
    const oldest = await db
      .select({ id: pageCaptures.id })
      .from(pageCaptures)
      .where(and(eq(pageCaptures.supplierId, supplierId), isNull(pageCaptures.expectedAnswer)))
      .orderBy(asc(pageCaptures.createdAt))
      .limit(total - MAX_PER_SUPPLIER);
    if (oldest.length > 0) await db.delete(pageCaptures).where(inArray(pageCaptures.id, oldest.map((o) => o.id)));
  }

  return {
    get,

    async create(input: { supplierId: string; mappingId: string | null; name: string }): Promise<CaptureSummary> {
      const [row] = await db.insert(pageCaptures).values(input).returning({ id: pageCaptures.id });
      await trim(input.supplierId);
      return (await get((row as { id: string }).id)) as CaptureSummary;
    },

    async fill(id: string, result: CaptureFill): Promise<void> {
      if (!UUID.test(id)) return;
      const values =
        result.status === "ready"
          ? { status: "ready", pageClass: result.pageClass, description: result.description, picture: result.picture }
          : { status: "failed", failureReason: result.failureReason };
      await db.update(pageCaptures).set(values).where(eq(pageCaptures.id, id));
    },

    async picture(id: string): Promise<Buffer | null> {
      if (!UUID.test(id)) return null;
      const [row] = await db.select({ picture: pageCaptures.picture }).from(pageCaptures).where(eq(pageCaptures.id, id)).limit(1);
      return row?.picture ?? null;
    },

    async list(supplierId: string): Promise<CaptureSummary[]> {
      if (!UUID.test(supplierId)) return [];
      return (await db.select(summaryColumns).from(pageCaptures).where(eq(pageCaptures.supplierId, supplierId)).orderBy(desc(pageCaptures.createdAt))) as CaptureSummary[];
    },

    /** The captures the owner labelled with an expected answer: the test examples for a recipe. */
    async examples(supplierId: string): Promise<{ id: string; name: string; expectedAnswer: ExpectedAnswer; mappingId: string | null; description: unknown }[]> {
      if (!UUID.test(supplierId)) return [];
      return (await db
        .select({ id: pageCaptures.id, name: pageCaptures.name, expectedAnswer: pageCaptures.expectedAnswer, mappingId: pageCaptures.mappingId, description: pageCaptures.description })
        .from(pageCaptures)
        .where(and(eq(pageCaptures.supplierId, supplierId), eq(pageCaptures.status, "ready"), isNotNull(pageCaptures.expectedAnswer)))
        .orderBy(asc(pageCaptures.createdAt))) as never;
    },

    /** The owner's name and expected answer. `expected: null` makes it a plain capture again. */
    async label(id: string, patch: { name?: string; expected?: ExpectedAnswer | null }): Promise<CaptureSummary | null> {
      if (!UUID.test(id)) return null;
      const set = { ...(patch.name === undefined ? {} : { name: patch.name }), ...(patch.expected === undefined ? {} : { expectedAnswer: patch.expected }) };
      if (Object.keys(set).length > 0) await db.update(pageCaptures).set(set).where(eq(pageCaptures.id, id));
      return (await get(id)) as CaptureSummary | null;
    },

    async remove(id: string): Promise<boolean> {
      if (!UUID.test(id)) return false;
      return (await db.delete(pageCaptures).where(eq(pageCaptures.id, id)).returning({ id: pageCaptures.id })).length > 0;
    },

    /** Keeps the page of a "page changed" check so the owner can see what changed. Only the latest three per link are kept. */
    async keepChanged(mappingId: string, page: { supplierId: string; pageClass: string; description: unknown; picture: Buffer | null }): Promise<string> {
      const [row] = await db
        .insert(pageCaptures)
        .values({ supplierId: page.supplierId, mappingId, name: "Page changed", status: "ready", pageClass: page.pageClass, description: page.description, picture: page.picture, keptReason: "page_changed" })
        .returning({ id: pageCaptures.id });
      const older = await db
        .select({ id: pageCaptures.id })
        .from(pageCaptures)
        .where(and(eq(pageCaptures.mappingId, mappingId), eq(pageCaptures.keptReason, "page_changed"), isNull(pageCaptures.expectedAnswer)))
        .orderBy(desc(pageCaptures.createdAt))
        .offset(MAX_CHANGED_PER_LINK);
      if (older.length > 0) await db.delete(pageCaptures).where(inArray(pageCaptures.id, older.map((o) => o.id)));
      await trim(page.supplierId);
      return (row as { id: string }).id;
    },

    /** Deletes unlabelled and page-changed captures older than `days`. A labelled example stays until the owner deletes it. */
    async purge(days = 30): Promise<number> {
      const gone = await db
        .delete(pageCaptures)
        .where(and(isNull(pageCaptures.expectedAnswer), lt(pageCaptures.createdAt, sql`now() - make_interval(days => ${days})`)))
        .returning({ id: pageCaptures.id });
      return gone.length;
    },
  };
}
