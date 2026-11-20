import { Check } from "lucide-react";
import { cn } from "@/lib/utils.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button.js";
import type {
  Api,
  Capture,
  ExampleResult,
  Mapping,
  RecipeTest,
  RecipeVersion,
  SuggestResult,
} from "../api.js";
import { Notice } from "../components/Notice.js";
import { PageHeader } from "../components/PageHeader.js";
import { Panel } from "../components/Panel.js";
import { emptyDraft, RuleEditor, toDraft, toRecipe, type Draft } from "../components/RuleEditor.js";
import { RuleSuggestions } from "../components/RuleSuggestions.js";
import { SavedPages } from "../components/SavedPages.js";
import { addSuggested } from "../components/suggestedRules.js";
import { VersionList } from "../components/VersionList.js";
import { ANSWER_WORDS, reasonWords } from "../components/stockWords.js";
import { toast } from "../lib/toast.js";
import { Link } from "../router.js";
import { useTitle } from "../useTitle.js";
import { useGetSupplierQuery } from "../store/api/suppliers/supplierApi.js";
import { useGetMappingListQuery } from "../store/api/mappings/mappingApi.js";

const POLL_MS = 3000;
const POLLS = 20;
const NO_LINKS: Mapping[] = [];
const message = (e: unknown) =>
  e instanceof Error ? e.message : "Something went wrong. Please try again.";
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function StockRulesPage({ api, supplierId }: { api: Api; supplierId: string }) {
  useTitle("Stock rules");
  const supplierQuery = useGetSupplierQuery(supplierId);
  const supplier = supplierQuery.data ?? null;
  // Only a first read that failed replaces the page; a failed read in the background keeps what is shown.
  const loadError = supplierQuery.isError && !supplierQuery.data ? message(supplierQuery.error) : null;
  const links = useGetMappingListQuery({ supplierId }).data ?? NO_LINKS;
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [versions, setVersions] = useState<RecipeVersion[] | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [startedFrom, setStartedFrom] = useState<number | null>(null);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"test" | "save" | "on" | "suggest" | null>(null);
  const [test, setTest] = useState<RecipeTest | null>(null);
  const [suggestions, setSuggestions] = useState<SuggestResult | null>(null);
  const polls = useRef(0);
  const rulesRef = useRef<HTMLDivElement>(null);

  const loadCaptures = useCallback(
    () =>
      api.captures
        .list(supplierId)
        .then(setCaptures)
        .catch((e: unknown) => setError(message(e))),
    [api, supplierId],
  );
  const loadVersions = useCallback(
    () =>
      api.recipes
        .list(supplierId)
        .then(setVersions)
        .catch((e: unknown) => setError(message(e))),
    [api, supplierId],
  );

  useEffect(() => {
    void loadCaptures();
    void loadVersions();
  }, [api, supplierId, loadCaptures, loadVersions]);

  // Start the editor from the rules that are on, else the newest version. Only the first time, so edits are never overwritten.
  useEffect(() => {
    if (started || !versions || versions.length === 0) return;
    const from = versions.find((v) => v.active) ?? versions[0]!;
    setDraft(toDraft(from.rules));
    setStartedFrom(from.version);
    setStarted(true);
  }, [versions, started]);

  // A capture takes a moment. The list is read again shortly after, and never after the page is left.
  useEffect(() => {
    if (!captures.some((c) => c.status === "pending") || polls.current >= POLLS) return;
    const timer = setTimeout(() => {
      polls.current += 1;
      void loadCaptures();
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [captures, loadCaptures]);

  async function run(kind: "test" | "save" | "on" | "suggest", work: () => Promise<void>) {
    setBusy(kind);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  }

  const runTest = () =>
    run("test", async () => {
      setTest(await api.recipes.test(supplierId, toRecipe(draft)));
    });
  const suggest = () =>
    run("suggest", async () => {
      setSuggestions(await api.recipes.suggest(supplierId));
    });
  const addPicked = (picked: Parameters<typeof addSuggested>[1]) => {
    setDraft(addSuggested(draft, picked));
    setTest(null);
    setSuggestions(null);
    toast(
      `Added ${picked.length} ${plural(picked.length, "rule", "rules")}. Test them before you save.`,
    );
  };
  const save = () =>
    run("save", async () => {
      const saved = await api.recipes.save(supplierId, toRecipe(draft));
      toast(`Saved as version ${saved.version}. It is not turned on yet.`);
      await loadVersions();
    });
  const turnOn = (v: RecipeVersion) =>
    run("on", async () => {
      await api.recipes.activate(v.id);
      toast(`Version ${v.version} is turned on. Stock checks use it now.`);
      await loadVersions();
    });
  const editAsNew = (v: RecipeVersion) => {
    setDraft(toDraft(v.rules));
    setStartedFrom(v.version);
    setTest(null);
    toast(`Version ${v.version} is loaded into the rules editor.`);
    rulesRef.current?.scrollIntoView?.({ behavior: "smooth", block: "center" });
  };
  const deleteVersion = async (v: RecipeVersion) => {
    await api.recipes.remove(v.id);
    toast(`Deleted version ${v.version}.`);
    await loadVersions();
  };

  const labelledPages = captures.filter((c) => c.status === "ready" && c.expectedAnswer !== null);
  const labelled = labelledPages.length;
  const bothLabelled =
    labelledPages.some((c) => c.expectedAnswer === "in_stock") &&
    labelledPages.some((c) => c.expectedAnswer === "out_of_stock");
  const turnOnBlock =
    labelled === 0
      ? "Label at least one saved page with the answer you expect."
      : test && !test.passed
        ? "Some examples do not give the answer you expect. Fix the rules and test again."
        : null;
  // Built-in data that never changes would pass on in-stock pages alone, so a version that uses it needs both answers labelled.
  const BOTH_NEEDED = "Label at least one in-stock and one out-of-stock saved page.";
  const turnOnBlockFor = (v: RecipeVersion) =>
    turnOnBlock ?? (v.rules.builtIn && !bothLabelled ? BOTH_NEEDED : null);
  const versionNote =
    turnOnBlock ??
    (versions?.some((v) => !v.active && v.rules.builtIn) && !bothLabelled ? BOTH_NEEDED : null);
  const failing = test ? test.results.filter((r) => !r.passed).length : 0;

  if (loadError) {
    return (
      <>
        <PageHeader title="Stock rules" />
        <div className="flex max-w-2xl flex-col items-start gap-3">
          <Notice kind="error" role="alert">
            {loadError}
          </Notice>
          <Button variant="outline" asChild>
            <Link to="/suppliers">Back to suppliers</Link>
          </Button>
        </div>
      </>
    );
  }

  const resultLine = (r: ExampleResult) => (
    <li key={r.id}>
      <strong>{r.name}</strong>: {r.passed ? "Passed" : "Failed"}.
      {!r.passed && (
        <>
          {" "}
          You expected {ANSWER_WORDS[r.expected]}, the rules said {ANSWER_WORDS[r.got.answer]}.{" "}
          {reasonWords(r.got.reason) ?? ""}
        </>
      )}
      {r.got.decidedBy && (
        <>
          {" "}
          {r.got.decidedBy === "built_in" ? "Decided by built-in data." : "Decided by your rules."}
        </>
      )}
    </li>
  );

  return (
    <>
      <PageHeader
        back={{ to: "/suppliers", label: "Back to suppliers" }}
        title="Stock rules"
        description="Teach the app how this supplier's pages show stock. The app reads the words on the page, never the picture. When it cannot tell, it says so and never guesses out of stock."
      />
      <p className="-mt-3 mb-4 text-sm font-semibold">{supplier ? supplier.name : "Loading…"}</p>
      <Steps captures={captures} versions={versions} />

      <div className="flex max-w-6xl flex-col gap-6">
        {error && (
          <Notice kind="error" role="alert">
            {error}
          </Notice>
        )}
        {supplier &&
          !supplier.needsLogin &&
          versions !== null &&
          !versions.some((v) => v.active) && (
            <Notice kind="info">
              This supplier needs no login, so it is already checked from its built-in stock data,
              with no stock rules needed. Its answers make suggestions on Proposals like any other
              supplier. Add rules here only if its pages have no built-in data.
            </Notice>
          )}

        <section aria-labelledby="pages-heading" className="border-y border-border">
          <div className="border-b border-border py-4">
            <h2 id="pages-heading" className="text-base font-semibold lg:text-[0.9375rem]">
              Saved pages
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Capture a real product page, then label saved pages with the answer you expect. Your
              rules are tested on them before they can be turned on.
            </p>
          </div>
          <SavedPages
            api={api}
            supplierId={supplierId}
            links={links}
            captures={captures}
            results={test?.results ?? []}
            reload={loadCaptures}
            onChanged={() => setTest(null)}
            onCaptureRequested={() => {
              polls.current = 0;
            }}
          />
        </section>

        <div ref={rulesRef}>
          <Panel
            id="rules-heading"
            title="Rules"
            description={
              startedFrom !== null
                ? `Starting from version ${startedFrom}. Saving makes a new version. No version is ever changed.`
                : "Saving makes version 1."
            }
          >
            {suggestions && (
              <RuleSuggestions
                result={suggestions}
                onAdd={addPicked}
                onClose={() => setSuggestions(null)}
              />
            )}
            <RuleEditor
              draft={draft}
              onChange={(d) => {
                setDraft(d);
                setTest(null);
              }}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={busy !== null}
                loading={busy === "suggest"}
                onClick={() => void suggest()}
              >
                Suggest rules
              </Button>
              <Button
                variant="outline"
                disabled={busy !== null}
                loading={busy === "test"}
                onClick={() => void runTest()}
              >
                Test all examples
              </Button>
              <Button
                disabled={busy !== null}
                loading={busy === "save"}
                onClick={() => void save()}
              >
                Save version
              </Button>
            </div>
            {test && (
              <div className="flex flex-col gap-3" aria-live="polite">
                {test.results.length === 0 ? (
                  <Notice kind="warning">
                    There are no labelled saved pages to test yet. Label a saved page with the
                    answer you expect.
                  </Notice>
                ) : test.passed ? (
                  <Notice kind="success">All examples give the answer you expect.</Notice>
                ) : (
                  <Notice kind="warning">{`${failing} ${plural(failing, "example does", "examples do")} not give the answer you expect.`}</Notice>
                )}
                <ul className="flex flex-col gap-1 text-sm" aria-label="Test results">
                  {test.results.map(resultLine)}
                </ul>
              </div>
            )}
          </Panel>
        </div>

        <Panel
          id="versions-heading"
          title="Versions"
          description="Open a version to see its rules and how it differs from another, before you turn it on."
        >
          {versions === null ? null : versions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No versions yet. Save the rules above to make version 1.
            </p>
          ) : (
            <>
              {versionNote && <p className="text-sm text-muted-foreground">{versionNote}</p>}
              <div className="border-y border-border">
                <VersionList
                  key={versions.map((v) => v.id).join()}
                  versions={versions}
                  busy={busy !== null}
                  turnOnBlock={turnOnBlockFor}
                  onTurnOn={(v) => void turnOn(v)}
                  onEdit={editAsNew}
                  onDelete={deleteVersion}
                />
              </div>
            </>
          )}
        </Panel>
      </div>
    </>
  );
}

/** Where the owner stands, in three steps: save example pages, write the rules, test and turn on. */
function Steps({ captures, versions }: { captures: Capture[]; versions: RecipeVersion[] | null }) {
  const labelled = captures.filter((c) => c.expectedAnswer !== null).length;
  const on = versions?.find((v) => v.active);
  const steps: { title: string; detail: string; done: boolean }[] = [
    {
      title: "Save example pages",
      detail:
        captures.length === 0
          ? "Capture a product page"
          : `${captures.length} saved · ${labelled} labelled`,
      done: labelled > 0,
    },
    {
      title: "Write the rules",
      detail:
        versions && versions.length > 0
          ? `${versions.length} ${versions.length === 1 ? "version" : "versions"} saved`
          : "Or press Suggest rules",
      done: (versions?.length ?? 0) > 0,
    },
    {
      title: "Test and turn on",
      detail: on ? `Version ${on.version} is on` : "No version is on yet",
      done: Boolean(on),
    },
  ];
  const now = steps.findIndex((x) => !x.done);
  return (
    <ol
      aria-label="Steps"
      className="mb-6 grid max-w-6xl border border-border bg-card sm:grid-cols-3"
    >
      {steps.map((x, i) => {
        const state = x.done ? "done" : i === now ? "now" : "later";
        return (
          <li
            key={x.title}
            data-state={state}
            className={cn(
              "flex gap-3 border-border p-3 max-sm:border-b max-sm:last:border-b-0 sm:border-r sm:last:border-r-0",
              state === "now" && "shadow-[inset_0_-2px_0_var(--foreground)]",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "grid size-6 shrink-0 place-items-center rounded-full border-[1.5px] font-mono text-xs font-semibold",
                x.done ? "border-good bg-good text-background" : "border-foreground",
              )}
            >
              {x.done ? <Check className="size-3.5" /> : i + 1}
            </span>
            <span className="min-w-0">
              <span data-step-title className="block text-sm font-semibold">
                {x.title}
              </span>
              <span className="block text-[0.8125rem] text-muted-foreground">
                <span className="sr-only">
                  {x.done ? "Done. " : state === "now" ? "Next. " : ""}
                </span>
                {x.detail}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
