import type { FastifyInstance, RawReplyDefaultExpression, RawRequestDefaultExpression, RawServerDefault } from "fastify";
import type { Logger } from "pino";
import type { createAuditWriter } from "@stock-monitor/audit";
import type { createCaptureRepository, createMappingRepository, createRecipeRepository, createSupplierRepository } from "@stock-monitor/db";
import { allPass, runExamples, validateRecipe, type Example, type PageDescription, type Recipe } from "@stock-monitor/extraction";
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
      rows.map(async (row) => ({
        id: row.id,
        name: row.name || "Unnamed capture",
        expected: row.expectedAnswer,
        page: row.description as PageDescription,
        region: ((row.mappingId ? (await mappings.get(row.mappingId))?.region : null) ?? defaultRegion) || null,
      })),
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
    const results = runExamples(await examplesFor(supplier.id, supplier.defaultRegion), valid(input.recipe));
    return { results, passed: allPass(results) };
  });

  app.post<{ Params: { id: string } }>("/api/recipes/:id/activate", async (request) => {
    const recipe = await recipes.get(request.params.id);
    if (!recipe) throw new AppError(404, "recipe_not_found", "That version does not exist.");
    const supplier = await suppliers.get(recipe.supplierId);
    if (!supplier) throw SUPPLIER_NOT_FOUND();
    const results = runExamples(await examplesFor(supplier.id, supplier.defaultRegion), valid(recipe.rules));
    if (results.length === 0) throw new AppError(409, "no_examples", "Label at least one saved page with the answer you expect before turning rules on.");
    if (!allPass(results)) {
      const failing = results.filter((r) => !r.passed).map((r) => r.name).join(", ");
      throw new AppError(409, "examples_failed", `These saved pages do not give the answer you expect: ${failing}. Fix the rules and test again.`);
    }
    const active = await recipes.activate(recipe.id);
    await record(request, "recipe.activated", "supplier", supplier.id, { version: recipe.version });
    return { recipe: active };
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
