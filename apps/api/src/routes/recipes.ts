import type { FastifyInstance, RawReplyDefaultExpression, RawRequestDefaultExpression, RawServerDefault } from "fastify";
import type { Logger } from "pino";
import type { createAuditWriter } from "@stock-monitor/audit";
import type { createCaptureRepository, createMappingRepository, createRecipeRepository, createSupplierRepository } from "@stock-monitor/db";
import { allPass, hasBothAnswers, runExamples, suggestRules, validateRecipe, type Example, type LinkRef, type PageDescription, type Recipe } from "@stock-monitor/extraction";
import { AppError } from "../errors.js";

type App = FastifyInstance<RawServerDefault, RawRequestDefaultExpression, RawReplyDefaultExpression, Logger>;
type Audit = ReturnType<typeof createAuditWriter>;

export type RecipeRoutesDeps = {
  recipes: ReturnType<typeof createRecipeRepository>;
  captures: ReturnType<typeof createCaptureRepository>;
  mappings: ReturnType<typeof createMappingRepository>;
  suppliers: ReturnType<typeof createSupplierRepository>;
};

const MAX_REGION = 200;
const SUPPLIER_NOT_FOUND = () => new AppError(404, "supplier_not_found", "That supplier does not exist.");

const object = (body: unknown, allowed: string[]): Record<string, unknown> => {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new AppError(400, "invalid_input", "Check the details and try again.");
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some((key) => !allowed.includes(key))) throw new AppError(400, "invalid_input", "Check the details and try again.");
  return input;
};

/** Stock rules: saving versions, testing a draft on the owner's labelled examples, and turning a version on. */
export function registerRecipeRoutes(app: App, deps: RecipeRoutesDeps, audit: Audit): void {
  const { recipes, captures, mappings, suppliers } = deps;
  const record = (request: { user: { id: string } | null; id: string }, action: string, entityType: string, id: string, details?: Record<string, unknown>) =>
    audit.record({ actorUserId: request.user?.id, action, entityType, entityId: id, details, requestId: request.id });

  const valid = (input: unknown): Recipe => {
    const checked = validateRecipe(input);
    if (!checked.ok) throw new AppError(400, "invalid_recipe", checked.message);
    return checked.recipe;
  };

  /** The saved pages the owner labelled, each with the region its link looks for (the link's own, else the supplier's default). */
  async function examplesFor(supplierId: string, defaultRegion: string | null): Promise<Example[]> {
    const rows = await captures.examples(supplierId);
    return Promise.all(
      rows.map(async (row) => {
        const page = row.description as PageDescription;
        const mapping = row.mappingId ? await mappings.get(row.mappingId) : null;
        // The link's current address and option, so a change is tested at once; else the copy kept on the saved page.
        const link: LinkRef = mapping ? { url: mapping.url, option: mapping.supplierOption } : { url: page.link?.url ?? null, option: page.link?.option ?? null };
        return { id: row.id, name: row.name || "Unnamed capture", expected: row.expectedAnswer, page, region: (mapping?.region ?? defaultRegion) || null, link };
      }),
    );
  }

  app.get<{ Params: { id: string } }>("/api/suppliers/:id/recipes", async (request) => ({ recipes: await recipes.list(request.params.id) }));

  app.post<{ Params: { id: string } }>("/api/suppliers/:id/recipes", async (request, reply) => {
    const input = object(request.body, ["recipe"]);
    if (!(await suppliers.get(request.params.id))) throw SUPPLIER_NOT_FOUND();
    const saved = await recipes.create(request.params.id, valid(input.recipe));
    await record(request, "recipe.saved", "supplier", request.params.id, { version: saved.version });
    return reply.status(201).send({ recipe: saved });
  });

  // Runs a draft on the saved examples and saves nothing.
  app.post<{ Params: { id: string } }>("/api/suppliers/:id/recipes/test", async (request) => {
    const input = object(request.body, ["recipe"]);
    const supplier = await suppliers.get(request.params.id);
    if (!supplier) throw SUPPLIER_NOT_FOUND();
    const recipe = valid(input.recipe);
    const results = runExamples(await examplesFor(supplier.id, supplier.defaultRegion), recipe);
    return { results, passed: allPass(results, recipe) };
  });

  // Proposes rules from the labelled examples. Read-only: nothing is saved, and the audit entry holds counts, never page text.
  app.post<{ Params: { id: string } }>("/api/suppliers/:id/recipes/suggest", async (request) => {
    object(request.body, []);
    const supplier = await suppliers.get(request.params.id);
    if (!supplier) throw SUPPLIER_NOT_FOUND();
    const examples = await examplesFor(supplier.id, supplier.defaultRegion);
    const result = suggestRules(examples);
    await record(request, "recipe.suggested", "supplier", supplier.id, { examples: examples.length, suggestions: result.ok ? result.suggestions.length : 0 });
    return result;
  });

  app.post<{ Params: { id: string } }>("/api/recipes/:id/activate", async (request) => {
    const recipe = await recipes.get(request.params.id);
    if (!recipe) throw new AppError(404, "recipe_not_found", "That version does not exist.");
    const supplier = await suppliers.get(recipe.supplierId);
    if (!supplier) throw SUPPLIER_NOT_FOUND();
    const results = runExamples(await examplesFor(supplier.id, supplier.defaultRegion), valid(recipe.rules));
    if (results.length === 0) throw new AppError(409, "no_examples", "Label at least one saved page with the answer you expect before turning rules on.");
    if (valid(recipe.rules).builtIn && !hasBothAnswers(results)) {
      throw new AppError(409, "examples_need_both", "Label at least one in-stock and one out-of-stock saved page before turning on rules that use built-in data.");
    }
    if (!allPass(results, valid(recipe.rules))) {
      const failing = results.filter((r) => !r.passed).map((r) => r.name).join(", ");
      throw new AppError(409, "examples_failed", `These saved pages do not give the answer you expect: ${failing}. Fix the rules and test again.`);
    }
    const active = await recipes.activate(recipe.id);
    await record(request, "recipe.activated", "supplier", supplier.id, { version: recipe.version });
    return { recipe: active };
  });

  app.delete<{ Params: { id: string } }>("/api/recipes/:id", async (request) => {
    const removed = await recipes.remove(request.params.id);
    if (removed.result === "not_found") throw new AppError(404, "recipe_not_found", "That version does not exist.");
    if (removed.result !== "deleted") throw new AppError(409, "recipe_active", "Turn another version on first.");
    await record(request, "recipe.deleted", "supplier", removed.supplierId, { version: removed.version });
    return { ok: true };
  });

  app.patch<{ Params: { id: string } }>("/api/suppliers/:id/region", async (request) => {
    const input = object(request.body, ["region"]);
    const region = input.region;
    if (region !== null && (typeof region !== "string" || region.length > MAX_REGION)) {
      throw new AppError(400, "invalid_region", `A region can be up to ${MAX_REGION} characters of text, or empty to clear it.`);
    }
    const supplier = await suppliers.setRegion(request.params.id, region === null ? null : region.trim() || null);
    if (!supplier) throw SUPPLIER_NOT_FOUND();
    await record(request, "supplier.region_set", "supplier", supplier.id, { set: supplier.defaultRegion !== null });
    return { supplier };
  });
}
