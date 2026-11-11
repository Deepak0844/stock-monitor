import { useEffect, useMemo, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge.js";
import { Button } from "@/components/ui/button.js";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog.js";
import { Input, Select } from "@/components/ui/input.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import { cn } from "@/lib/utils.js";
import { toast } from "@/lib/toast.js";
import type { Api, Capture, CaptureDetail, ExampleResult, Mapping, StockAnswer } from "../api.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { Field } from "./Field.js";
import { Notice } from "./Notice.js";
import { ANSWER_WORDS, captureFailureWords } from "./stockWords.js";
import { formatWhen } from "../format.js";

const message = (e: unknown) =>
  e instanceof Error ? e.message : "Something went wrong. Please try again.";

type Props = {
  api: Api;
  supplierId: string;
  links: Mapping[];
  captures: Capture[];
  /** Results of the last "Test all examples", by saved page. */
  results: ExampleResult[];
  /** Reads the list of saved pages again. */
  reload: () => Promise<unknown>;
  /** Called when a label changes or a page goes, so an old test result is not trusted. */
  onChanged: () => void;
  /** Called when a capture was asked for, so the list is followed until it is ready. */
  onCaptureRequested: () => void;
};

const badgeFor = (c: Capture) =>
  c.status === "pending" ? (
    <Badge variant="warning" className="animate-pulse">
      Capturing…
    </Badge>
  ) : c.status === "failed" ? (
    <Badge variant="danger">Could not capture</Badge>
  ) : c.expectedAnswer ? (
    <Badge variant="success">Expected: {ANSWER_WORDS[c.expectedAnswer]}</Badge>
  ) : (
    <Badge variant="neutral">Not labelled</Badge>
  );

/**
 * The saved pages: a list on the left and the chosen page on the right, in a card of fixed height, so a long page never pushes the
 * rules and versions down. On a phone the list and the page take turns.
 */
export function SavedPages({
  api,
  supplierId,
  links,
  captures,
  results,
  reload,
  onChanged,
  onCaptureRequested,
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [phoneView, setPhoneView] = useState<"list" | "page">("list");
  const [mappingId, setMappingId] = useState("");
  const [capturing, setCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<CaptureDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [tab, setTab] = useState<"picture" | "text">("picture");
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [expected, setExpected] = useState<StockAnswer | "">("");
  const [saving, setSaving] = useState(false);
  const [labelError, setLabelError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [full, setFull] = useState(false);

  // Choose the first page when there is none chosen, or the chosen one has gone.
  useEffect(() => {
    if (selectedId && captures.some((c) => c.id === selectedId)) return;
    setSelectedId(captures[0]?.id ?? null);
  }, [captures, selectedId]);

  const selected = captures.find((c) => c.id === selectedId) ?? null;
  // Details count only for the page that is chosen, so the form of the page just left is never shown for the new one.
  const detail = loaded && loaded.id === selectedId ? loaded : null;
  const ready = selected?.status === "ready";

  useEffect(() => {
    setLoaded(null);
    setDetailError(null);
    setSearch("");
    if (!selected || selected.status !== "ready") return;
    let current = true;
    api.captures
      .get(selected.id)
      .then((d) => {
        if (!current) return;
        setLoaded(d);
        setName(d.name);
        setExpected(d.expectedAnswer ?? "");
      })
      .catch((e: unknown) => current && setDetailError(message(e)));
    return () => {
      current = false;
    };
    // Read again when the page becomes ready or its label is saved, not on every poll of the list.
  }, [api, selected?.id, selected?.status]);

  async function capture() {
    setCaptureError(null);
    if (!mappingId) return setCaptureError("Choose the link whose page you want to capture.");
    setCapturing(true);
    try {
      await api.captures.request(supplierId, { mappingId });
      onCaptureRequested();
      toast("Capturing the page. It will appear in the list in a moment.");
      await reload();
    } catch (e) {
      setCaptureError(message(e));
    } finally {
      setCapturing(false);
    }
  }

  async function saveLabel() {
    if (!detail) return;
    setSaving(true);
    setLabelError(null);
    try {
      await api.captures.label(detail.id, {
        name: name.trim(),
        expected: expected === "" ? null : expected,
      });
      toast("Label saved.");
      setLoaded({ ...detail, name: name.trim(), expectedAnswer: expected === "" ? null : expected });
      onChanged();
      await reload();
    } catch (e) {
      setLabelError(message(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!selected) return;
    await api.captures.remove(selected.id);
    toast("Deleted the saved page.");
    onChanged();
    setPhoneView("list");
    await reload();
  }

  const lines = useMemo(() => {
    if (!detail?.description) return [];
    const out: { key: string; text: string; heading?: boolean }[] = [];
    detail.description.sections.forEach((s, i) => {
      if (s.heading !== null) out.push({ key: `h${i}`, text: s.heading, heading: true });
      s.lines.forEach((line, j) => out.push({ key: `l${i}-${j}`, text: line }));
    });
    if (detail.description.buttons.length > 0) {
      out.push({ key: "buttons", text: "Buttons", heading: true });
      detail.description.buttons.forEach((b, i) =>
        out.push({
          key: `b${i}`,
          text: `${b.label} (${b.enabled ? "enabled" : "disabled"}${b.section ? `, under ${b.section}` : ""})`,
        }),
      );
    }
    return out;
  }, [detail]);
  const needle = search.trim().toLowerCase();
  const shown = needle ? lines.filter((l) => l.text.toLowerCase().includes(needle)) : lines;

  async function copy() {
    const text = lines.map((l) => l.text).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied the page text.");
    } catch {
      toast("Could not copy. Select the text and copy it instead.");
    }
  }

  const resultFor = (id: string) => results.find((r) => r.id === id);

  return (
    <div className="grid h-[40rem] min-h-0 md:h-[42rem] md:grid-cols-[minmax(0,21rem)_minmax(0,1fr)]">
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-col border-border md:border-r",
          phoneView === "page" && "max-md:hidden",
        )}
      >
        <div className="flex flex-col gap-2 border-b border-border p-3">
          <div className="flex gap-2">
            <Select
              aria-label="Link to capture"
              className="min-w-0 flex-1"
              value={mappingId}
              onChange={(e) => setMappingId(e.target.value)}
            >
              <option value="">Choose a link</option>
              {links.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.productTitle} · {m.variantTitle}
                  {m.sku ? ` · ${m.sku}` : ""}
                </option>
              ))}
            </Select>
            <Button size="sm" className="h-11" loading={capturing} onClick={() => void capture()}>
              Capture
            </Button>
          </div>
          {captureError && (
            <Notice kind="error" role="alert">
              {captureError}
            </Notice>
          )}
        </div>
        {captures.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            No saved pages yet. Capture a page from one of this supplier's links to start.
          </p>
        ) : (
          <ul aria-label="Saved pages" className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {captures.map((c) => {
              const r = resultFor(c.id);
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    aria-current={c.id === selectedId}
                    onClick={() => {
                      setSelectedId(c.id);
                      setPhoneView("page");
                      setTab("picture");
                    }}
                    className={cn(
                      "flex w-full flex-col items-start gap-1 rounded-lg border-l-[3px] border-transparent px-3 py-2.5 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring",
                      c.id === selectedId && "border-accent bg-muted",
                    )}
                  >
                    <span className="font-semibold">{c.name || "Unnamed capture"}</span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      {badgeFor(c)}
                      {r && (
                        <Badge variant={r.passed ? "success" : "danger"}>
                          {r.passed ? "Test passes" : "Test fails"}
                        </Badge>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {c.status === "pending"
                        ? "Taking the picture…"
                        : c.status === "failed"
                          ? `Could not capture. ${captureFailureWords(c.failureReason)}`
                          : `Saved ${formatWhen(c.createdAt)}${c.keptReason === "page_changed" ? " · Kept because the page changed" : ""}`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className={cn("flex min-h-0 min-w-0 flex-col", phoneView === "list" && "max-md:hidden")}>
        {!selected ? (
          <p className="p-6 text-sm text-muted-foreground">Choose a saved page to see it here.</p>
        ) : (
          <>
            <div className="flex flex-col gap-3 border-b border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="md:hidden"
                    onClick={() => setPhoneView("list")}
                  >
                    <ChevronLeft aria-hidden="true" />
                    All pages
                  </Button>
                  <h3 className="truncate text-base font-semibold">
                    {selected.name || "Unnamed capture"}
                  </h3>
                </div>
                <Button variant="outline" size="sm" onClick={() => setDeleting(true)}>
                  Delete page
                </Button>
              </div>
              {ready && detail && (
                <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,12rem)_auto]">
                  <Field id="label-name" label="Name">
                    <Input
                      id="label-name"
                      type="text"
                      autoComplete="off"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </Field>
                  <Field id="label-expected" label="Answer you expect">
                    <Select
                      id="label-expected"
                      className="w-full"
                      value={expected}
                      onChange={(e) => setExpected(e.target.value as StockAnswer | "")}
                    >
                      <option value="">Not labelled</option>
                      <option value="in_stock">In stock</option>
                      <option value="out_of_stock">Out of stock</option>
                      <option value="cannot_tell">Cannot tell</option>
                    </Select>
                  </Field>
                  <Button loading={saving} onClick={() => void saveLabel()}>
                    Save label
                  </Button>
                </div>
              )}
              {ready && detail?.expectedAnswer && (
                <p className="text-xs text-muted-foreground">
                  Contains a picture of the page. Delete it when you no longer need it.
                </p>
              )}
              {labelError && (
                <Notice kind="error" role="alert">
                  {labelError}
                </Notice>
              )}
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
              {selected.status === "pending" && (
                <div className="flex flex-col gap-3">
                  <p role="status" className="text-sm font-medium">
                    Taking the picture…
                  </p>
                  <Skeleton className="h-28 w-full rounded-lg" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              )}
              {selected.status === "failed" && (
                <Notice kind="error">
                  Could not capture this page. {captureFailureWords(selected.failureReason)}
                </Notice>
              )}
              {ready && detailError && (
                <Notice kind="error" role="alert">
                  {detailError}
                </Notice>
              )}
              {ready && !detailError && !detail && (
                <div className="flex flex-col gap-3" aria-busy="true">
                  <Skeleton className="h-6 w-48" />
                  <Skeleton className="h-40 w-full rounded-lg" />
                </div>
              )}
              {ready && detail && (
                <>
                  {(() => {
                    const r = resultFor(detail.id);
                    return r && !r.passed ? (
                      <Notice kind="warning">
                        You expected {ANSWER_WORDS[r.expected]}, the rules said{" "}
                        {ANSWER_WORDS[r.got.answer]}.
                      </Notice>
                    ) : null;
                  })()}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div
                      role="tablist"
                      aria-label="Saved page view"
                      className="inline-flex rounded-lg bg-muted p-1"
                    >
                      {(["picture", "text"] as const).map((t) => (
                        <button
                          key={t}
                          role="tab"
                          type="button"
                          aria-selected={tab === t}
                          onClick={() => setTab(t)}
                          className="min-h-9 rounded-md px-4 text-sm font-semibold text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring aria-selected:bg-primary aria-selected:text-primary-foreground"
                        >
                          {t === "picture" ? "Picture" : "Page text"}
                        </button>
                      ))}
                    </div>
                    {tab === "picture" ? (
                      detail.hasPicture && (
                        <Button variant="outline" size="sm" onClick={() => setFull(true)}>
                          Open full size
                        </Button>
                      )
                    ) : (
                      <div className="flex items-center gap-2">
                        <Input
                          type="search"
                          aria-label="Search the text"
                          placeholder="Search the text"
                          className="h-10 w-44"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                        <Button variant="outline" size="sm" onClick={() => void copy()}>
                          Copy text
                        </Button>
                      </div>
                    )}
                  </div>
                  {tab === "picture" ? (
                    <div
                      role="tabpanel"
                      className="min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-muted/50 p-2"
                    >
                      {detail.hasPicture ? (
                        <img
                          className="mx-auto h-auto max-w-full"
                          src={api.captures.pictureUrl(detail.id)}
                          alt="Picture of the saved page"
                        />
                      ) : (
                        <p className="p-4 text-sm text-muted-foreground">
                          This page has no picture.
                        </p>
                      )}
                    </div>
                  ) : (
                    <div
                      role="tabpanel"
                      aria-label="What the page said"
                      tabIndex={0}
                      className="min-h-0 flex-1 overflow-auto rounded-lg border border-border p-2 text-sm"
                    >
                      {shown.length === 0 ? (
                        <p className="p-2 text-muted-foreground">
                          {lines.length === 0
                            ? "The page said nothing the rules can read."
                            : "No lines match."}
                        </p>
                      ) : (
                        <ul className="flex flex-col gap-0.5">
                          {shown.map((l) =>
                            l.heading ? (
                              <li
                                key={l.key}
                                className="mt-2 px-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground first:mt-0"
                              >
                                {l.text}
                              </li>
                            ) : (
                              <li key={l.key} className="rounded px-1.5 py-0.5">
                                {l.text}
                              </li>
                            ),
                          )}
                        </ul>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>

      {full && detail && (
        <Dialog open onOpenChange={(o) => !o && setFull(false)}>
          <DialogContent className="max-h-[90vh] max-w-4xl overflow-auto">
            <DialogTitle className="mb-2 text-base font-semibold">
              {detail.name || "Saved page"}
            </DialogTitle>
            <DialogDescription className="sr-only">The saved page at full size.</DialogDescription>
            <img
              className="h-auto max-w-full"
              src={api.captures.pictureUrl(detail.id)}
              alt="Saved page at full size"
            />
          </DialogContent>
        </Dialog>
      )}
      {deleting && selected && (
        <ConfirmDialog
          open
          title={`Delete ${selected.name || "this saved page"}?`}
          description="Its picture and text are removed and cannot be recovered."
          confirmLabel="Delete saved page"
          onConfirm={remove}
          onClose={() => setDeleting(false)}
        />
      )}
    </div>
  );
}
