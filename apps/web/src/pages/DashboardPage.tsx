import { useCallback, useEffect, useState, type ReactNode } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Card } from "@/components/ui/card.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import type { Api, AppNotification, ScheduleRow, Supplier } from "../api.js";
import { PageHeader } from "../components/PageHeader.js";
import { whenWords } from "../components/scheduleWords.js";
import { IconApprovals, IconLink, IconRefresh } from "../components/icons.js";
import { Notice } from "../components/Notice.js";
import { Link } from "../router.js";
import { useTitle } from "../useTitle.js";

/** One number and what it means, with the link to the list behind it. A shimmer while loading, a retry if it failed. */
function SummaryCard(props: { icon: ReactNode; title: string; state: "loading" | "error" | "ok"; value: string; note: string; action?: ReactNode; onRetry?: () => void }) {
  const id = `card-${props.title.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <section className="flex flex-col gap-1 rounded-xl border border-border bg-card p-4 shadow-sm" aria-labelledby={id} aria-busy={props.state === "loading"}>
      <div className="mb-2 grid size-9 place-items-center rounded-lg bg-muted text-foreground">{props.icon}</div>
      <h2 id={id} className="text-sm font-semibold text-muted-foreground">
        {props.title}
      </h2>
      {props.state === "loading" ? (
        <>
          <Skeleton className="mt-1 h-8 w-24" />
          <Skeleton className="mt-2 h-4 w-40" />
        </>
      ) : (
        <>
          <p className="text-3xl font-bold tabular-nums leading-tight">{props.value}</p>
          <p className="text-sm text-muted-foreground">{props.note}</p>
        </>
      )}
      {props.state === "error" && props.onRetry && (
        <div className="mt-2">
          <Button variant="outline" size="sm" onClick={props.onRetry}>
            Try again
          </Button>
        </div>
      )}
      {props.action && <div className="mt-3">{props.action}</div>}
    </section>
  );
}

const seeLink = (to: string, label: string) => (
  <Button variant="outline" size="sm" asChild>
    <Link to={to}>{label}</Link>
  </Button>
);

// A link in one of these states is wrong, moved or gone, so the owner should look at it.
const NEEDS_ATTENTION = new Set(["never_worked", "page_missing", "moved", "looks_different"]);

const STEPS = [
  ["Check suppliers", "Stock is read from each supplier's website on a schedule you choose."],
  ["Propose changes", "When supplier stock differs from your store, a change is proposed."],
  ["You approve", "Review the current and proposed values. Approve, edit or reject."],
  ["Update Shopify", "Only approved changes are sent to your store, and the result is recorded."],
] as const;

const messageOf = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong. Please try again.");

export function DashboardPage({ api }: { api: Api }) {
  useTitle("Dashboard");
  const [notes, setNotes] = useState<AppNotification[] | null>(null);
  const [notesError, setNotesError] = useState<string | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[] | "error" | null>(null);
  const [waiting, setWaiting] = useState(0);
  const [links, setLinks] = useState<{ unmapped: number; total: number; attention: number; answers: { in: number; out: number; unsure: number } } | "error" | null>(null);
  const [schedule, setSchedule] = useState<ScheduleRow[] | "error" | null>(null);

  const loadNotes = useCallback(() => {
    setNotesError(null);
    api.notifications
      .list()
      .then(setNotes)
      .catch((e: unknown) => setNotesError(messageOf(e)));
  }, [api]);
  const loadSuppliers = useCallback(() => {
    setSuppliers(null);
    api.suppliers.list().then(setSuppliers).catch(() => setSuppliers("error"));
  }, [api]);
  const loadSchedule = useCallback(() => {
    setSchedule(null);
    api.schedule.overview().then(setSchedule).catch(() => setSchedule("error"));
  }, [api]);
  const loadLinks = useCallback(() => {
    setLinks(null);
    Promise.all([api.mappings.unmapped(), api.mappings.list({})])
      .then(([u, all]) =>
        setLinks({
          unmapped: u.unmapped,
          total: u.total,
          attention: all.filter((m) => NEEDS_ATTENTION.has(m.linkStatus)).length,
          answers: {
            in: all.filter((m) => m.latestStock?.answer === "in_stock").length,
            out: all.filter((m) => m.latestStock?.answer === "out_of_stock").length,
            unsure: all.filter((m) => m.latestStock?.answer === "cannot_tell").length,
          },
        }),
      )
      .catch(() => setLinks("error"));
  }, [api]);
  useEffect(loadNotes, [loadNotes]);
  useEffect(loadSuppliers, [loadSuppliers]);
  useEffect(loadSchedule, [loadSchedule]);
  useEffect(loadLinks, [loadLinks]);
  useEffect(() => {
    api.proposals.count().then(setWaiting).catch(() => {});
  }, [api]);

  const stateOf = (v: unknown) => (v === null ? "loading" : v === "error" ? "error" : "ok") as "loading" | "error" | "ok";
  const connected = Array.isArray(suppliers) ? suppliers.filter((s) => s.sessionStatus === "connected").length : 0;
  const needReconnect = Array.isArray(suppliers) ? suppliers.filter((s) => s.sessionStatus === "needs_reconnect").length : 0;
  const total = Array.isArray(suppliers) ? suppliers.length : 0;
  const supplierCard =
    suppliers === "error"
      ? { value: "–", note: "Could not load suppliers." }
      : total === 0
        ? { value: "0", note: "No suppliers yet." }
        : { value: `${connected} of ${total}`, note: "suppliers connected." };

  const linkCard =
    links === "error" || links === null
      ? { value: "–", note: "Could not load links." }
      : links.total === 0
        ? { value: "0", note: "No variants from Shopify yet." }
        : { value: `${links.unmapped} of ${links.total}`, note: `variants not mapped. ${links.attention} ${links.attention === 1 ? "link needs" : "links need"} attention.` };

  const answered = links !== null && links !== "error" ? links.answers.in + links.answers.out + links.answers.unsure : 0;
  const stockCard =
    links === "error" || links === null
      ? { value: "–", note: "Could not load stock answers." }
      : answered === 0
        ? { value: "None", note: "No stock checks yet." }
        : { value: `${links.answers.in} in stock`, note: `${links.answers.out} out of stock, ${links.answers.unsure} cannot tell.` };

  const on = Array.isArray(schedule) ? schedule.filter((r) => r.intervalMinutes !== null) : [];
  const nextAt = on.map((r) => r.nextCheckAt).filter((t): t is string => t !== null).sort()[0] ?? null;
  const checksCard =
    schedule === "error" || schedule === null
      ? { value: "–", note: "Could not load the schedule." }
      : on.length === 0
        ? { value: "None", note: "No checks scheduled." }
        : {
            value: `${on.length} ${on.length === 1 ? "supplier" : "suppliers"}`,
            note: on.some((r) => r.status.state === "running") ? "Checking now." : nextAt ? `Next check: ${whenWords(nextAt)}.` : "Automatic checks are on.",
          };

  return (
    <>
      <PageHeader title="Dashboard" description="A quick view of your suppliers and what needs your approval." />

      <section className="mb-6 rounded-xl border border-border bg-card p-4 shadow-sm" aria-labelledby="attention-heading" aria-busy={notes === null && notesError === null}>
        <h2 id="attention-heading" className="mb-3 text-base font-semibold">
          Needs attention
        </h2>
        {notes === null && notesError === null && (
          <div className="flex flex-col gap-2">
            <p role="status" className="sr-only">
              Loading…
            </p>
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        )}
        {notesError !== null && (
          <div className="flex flex-col items-start gap-3">
            <Notice kind="error" role="alert">
              {notesError}
            </Notice>
            <Button onClick={loadNotes}>Try again</Button>
          </div>
        )}
        {notes !== null && notes.length === 0 && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
            Nothing needs your attention.
          </p>
        )}
        {notes !== null && notes.length > 0 && (
          <ul className="flex flex-col gap-2">
            {notes.map((n) => (
              <li key={n.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm font-medium text-warning">
                <span className="min-w-0">{n.message}</span>
                {n.kind === "proposal_needs_attention" ? (
                  <Button size="sm" asChild>
                    <Link to="/proposals">See proposals</Link>
                  </Button>
                ) : n.kind === "recipe_needs_review" ? (
                  <Button size="sm" asChild>
                    <Link to={`/suppliers/${n.supplierId}/rules`} aria-label={`Review stock rules ${n.supplierName}`}>
                      Review stock rules
                    </Link>
                  </Button>
                ) : (
                  <Button size="sm" asChild>
                    <Link to={`/suppliers/${n.supplierId}/connect`} aria-label={`Reconnect supplier ${n.supplierName}`}>
                      Reconnect supplier
                    </Link>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <SummaryCard
          icon={<IconLink />}
          title="Supplier connections"
          state={stateOf(suppliers)}
          value={supplierCard.value}
          note={supplierCard.note}
          onRetry={loadSuppliers}
          action={
            Array.isArray(suppliers) && total > 0
              ? needReconnect > 0
                ? seeLink("/suppliers?status=needs_reconnect", "See suppliers that need reconnecting")
                : seeLink("/suppliers", "See suppliers")
              : undefined
          }
        />
        <SummaryCard
          icon={<IconLink />}
          title="Supplier links"
          state={stateOf(links)}
          value={linkCard.value}
          note={linkCard.note}
          onRetry={loadLinks}
          action={links !== null && links !== "error" && links.total > 0 ? seeLink("/mappings", "See links") : undefined}
        />
        <SummaryCard icon={<IconRefresh />} title="Stock answers" state={stateOf(links)} value={stockCard.value} note={stockCard.note} onRetry={loadLinks} />
        <SummaryCard icon={<IconRefresh />} title="Stock checks" state={stateOf(schedule)} value={checksCard.value} note={checksCard.note} onRetry={loadSchedule} action={on.length > 0 ? seeLink("/suppliers", "See automatic checks") : undefined} />
        <SummaryCard
          icon={<IconApprovals />}
          title="Waiting for your approval"
          state="ok"
          value={String(waiting)}
          note={waiting > 0 ? "Suggested changes to your Shopify stock are waiting for you." : "Nothing to review. Proposed Shopify changes will appear here."}
          action={waiting > 0 ? seeLink("/proposals", "Review suggestions") : undefined}
        />
      </div>

      <Card className="p-4" aria-labelledby="how-heading" role="region">
        <h2 id="how-heading" className="mb-3 text-base font-semibold">
          How it works
        </h2>
        <ol className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-labelledby="how-heading">
          {STEPS.map(([title, text], i) => (
            <li key={title} className="flex gap-3">
              <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-full bg-accent text-sm font-bold text-accent-foreground">
                {i + 1}
              </span>
              <span className="flex flex-col">
                <strong className="text-sm">{title}</strong>
                <span className="text-sm text-muted-foreground">{text}</span>
              </span>
            </li>
          ))}
        </ol>
      </Card>
    </>
  );
}
