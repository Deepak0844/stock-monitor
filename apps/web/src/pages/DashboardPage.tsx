import { useCallback, useEffect, useState, type ReactNode } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import type { Api, AppNotification, Proposal, ScheduleRow, Supplier } from "../api.js";
import { recentChecksSentence } from "../components/recentChecks.js";
import { toast } from "../lib/toast.js";
import { PageHeader } from "../components/PageHeader.js";
import { Notice } from "../components/Notice.js";
import { Link } from "../router.js";
import { useTitle } from "../useTitle.js";
import { useApproveProposalMutation, useGetProposalCountQuery, useGetProposalOpenListQuery } from "../store/api/proposals/proposalApi.js";
import { useGetSupplierListQuery } from "../store/api/suppliers/supplierApi.js";
import { useGetNotificationListQuery } from "../store/api/notifications/notificationApi.js";
import { useGetScheduleOverviewQuery } from "../store/api/schedule/scheduleApi.js";

/** One number and what it means, with the link to the list behind it. A shimmer while loading, a retry if it failed. */
function SummaryCard(props: {
  title: string;
  state: "loading" | "error" | "ok";
  value: string;
  note: string;
  action?: ReactNode;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const id = `card-${props.title.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <section
      className="flex flex-col gap-0.5 bg-background px-4 py-3"
      aria-labelledby={id}
      aria-busy={props.state === "loading"}
    >
      <h2 id={id} className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {props.title}
      </h2>
      {props.state === "loading" ? (
        <>
          <Skeleton className="mt-1 h-6 w-20" />
          <Skeleton className="mt-1 h-3 w-32" />
        </>
      ) : (
        <>
          <p className="font-mono text-2xl leading-tight font-medium tracking-tight">
            {props.value}
          </p>
          <p className="text-[0.8125rem] text-muted-foreground">{props.note}</p>
          {props.children}
        </>
      )}
      {props.state === "error" && props.onRetry && (
        <div className="mt-2">
          <Button variant="outline" size="sm" onClick={props.onRetry}>
            Try again
          </Button>
        </div>
      )}
      {props.action && <div className="mt-2">{props.action}</div>}
    </section>
  );
}

/** A thin bar split into parts by size, for numbers already said in words. Decoration only, so hidden from screen readers.
 * Drawn in SVG so the sizes are attributes, not inline styles. */
function Split({ parts, className }: { parts: [string, number][]; className?: string }) {
  const total = parts.reduce((sum, [, n]) => sum + n, 0) || 1;
  let x = 0;
  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${total} 1`}
      preserveAspectRatio="none"
      className={`block h-1.5 w-full ${className ?? ""}`}
    >
      {parts.map(([fill, n]) => {
        const at = x;
        x += n;
        return (
          <rect key={fill} x={at} width={n} height={1} className={fill.replace("bg-", "fill-")} />
        );
      })}
    </svg>
  );
}

const seeLink = (to: string, label: string, name?: string) => (
  <Button
    variant="link"
    size="sm"
    className="h-auto min-h-10 whitespace-normal px-0 text-left lg:min-h-7"
    asChild
  >
    <Link to={to} aria-label={name}>
      {label}
    </Link>
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

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

const messageOf = (e: unknown) =>
  e instanceof Error ? e.message : "Something went wrong. Please try again.";

export function DashboardPage({ api }: { api: Api }) {
  useTitle("Dashboard");
  const notesQuery = useGetNotificationListQuery();
  const notes: AppNotification[] | null = notesQuery.data ?? null;
  const notesError = notesQuery.isError && !notesQuery.isFetching && !notesQuery.data ? messageOf(notesQuery.error) : null;
  const loadNotes = () => void notesQuery.refetch();
  const supplierList = useGetSupplierListQuery();
  const suppliers: Supplier[] | "error" | null =
    supplierList.data ?? (supplierList.isError && !supplierList.isFetching ? "error" : null);
  const loadSuppliers = () => void supplierList.refetch();
  const waiting = useGetProposalCountQuery().data ?? 0;
  const [links, setLinks] = useState<
    | {
        unmapped: number;
        total: number;
        attention: number;
        answers: { in: number; out: number; unsure: number };
      }
    | "error"
    | null
  >(null);
  const scheduleQuery = useGetScheduleOverviewQuery();
  const schedule: ScheduleRow[] | "error" | null =
    scheduleQuery.data ?? (scheduleQuery.isError && !scheduleQuery.isFetching ? "error" : null);
  const loadSchedule = () => void scheduleQuery.refetch();

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
  useEffect(loadLinks, [loadLinks]);
  // The newest suggestions, so the owner can approve from here.
  // No re-read while one waits for Shopify here: approved ones simply leave this short list.
  const newestList = useGetProposalOpenListQuery({ page: 1, pageSize: 5 }, { poll: false });
  const newest = newestList.data ? newestList.data.items.filter((x) => x.state === "open") : newestList.isError ? [] : null;
  const approveProposal = useApproveProposalMutation();
  const [approving, setApproving] = useState<string | null>(null);
  const approve = (p: Proposal) => {
    setApproving(p.id);
    approveProposal
      .mutateAsync({ id: p.id })
      .then(() => toast(`Approved. ${p.productTitle} will be updated in Shopify.`))
      .catch((e: unknown) => toast(messageOf(e), { kind: "error" }))
      .finally(() => setApproving(null));
  };

  const stateOf = (v: unknown) =>
    (v === null ? "loading" : v === "error" ? "error" : "ok") as "loading" | "error" | "ok";
  // A supplier is ready when its pages need no login, or its login is connected.
  const list = Array.isArray(suppliers) ? suppliers : [];
  const ready = list.filter((s) => !s.needsLogin || s.sessionStatus === "connected").length;
  const total = list.length;
  const needLogin = total - ready;
  const supplierCard =
    suppliers === "error"
      ? { value: "–", note: "Could not load suppliers." }
      : total === 0
        ? { value: "0", note: "No suppliers yet." }
        : {
            value: `${ready} of ${total}`,
            note:
              needLogin === 0
                ? "ready to check."
                : `ready to check. ${needLogin} ${needLogin === 1 ? "supplier needs" : "suppliers need"} you to log in.`,
          };

  const linkCard =
    links === "error" || links === null
      ? { value: "–", note: "Could not load links." }
      : links.total === 0
        ? { value: "0", note: "No variants from Shopify yet." }
        : {
            value: `${links.unmapped} of ${links.total}`,
            note: `variants not mapped. ${links.attention} ${links.attention === 1 ? "link needs" : "links need"} attention.`,
          };

  const answered =
    links !== null && links !== "error"
      ? links.answers.in + links.answers.out + links.answers.unsure
      : 0;
  const stockCard =
    links === "error" || links === null
      ? { value: "–", note: "Could not load stock answers." }
      : answered === 0
        ? { value: "None", note: "No stock checks yet." }
        : {
            value: `${links.answers.in} in stock`,
            note: `${links.answers.out} out of stock, ${links.answers.unsure} cannot tell.`,
          };

  const on = Array.isArray(schedule) ? schedule.filter((r) => r.intervalMinutes !== null) : [];
  const nextAt =
    on
      .map((r) => r.nextCheckAt)
      .filter((t): t is string => t !== null)
      .sort()[0] ?? null;
  const checksCard =
    schedule === "error" || schedule === null
      ? { value: "–", note: "Could not load the schedule." }
      : on.length === 0
        ? { value: "None", note: "No checks scheduled." }
        : {
            value: `${on.length} ${on.length === 1 ? "supplier" : "suppliers"}`,
            note: on.some((r) => r.status.state === "running")
              ? "Checking now."
              : nextAt
                ? `Next check: ${clock(nextAt)}.`
                : "Automatic checks are on.",
          };

  const noSuppliers = Array.isArray(suppliers) && suppliers.length === 0;
  const now = new Date();
  const linked = links !== null && links !== "error" ? links.total - links.unmapped : 0;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="A quick view of your suppliers and what needs your approval."
      />

      <section
        className="mb-6"
        aria-labelledby="attention-heading"
        aria-busy={notes === null && notesError === null}
      >
        <h2
          id="attention-heading"
          className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
        >
          Needs attention
        </h2>
        {notes === null && notesError === null && (
          <div className="flex flex-col gap-2">
            <p role="status" className="sr-only">
              Loading…
            </p>
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
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
          <p className="flex items-center gap-2 border-y border-rule-soft py-2.5 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 text-good" aria-hidden="true" />
            Nothing needs your attention.
          </p>
        )}
        {notes !== null && notes.length > 0 && (
          <ul className="flex flex-col border-t border-rule-soft">
            {notes.map((n) => (
              <li
                key={n.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-rule-soft py-2.5 text-sm"
              >
                <span className="flex min-w-0 items-center gap-2.5 font-medium">
                  <span aria-hidden="true" className="size-[7px] shrink-0 rounded-full bg-bad" />
                  {n.message}
                </span>
                {n.kind === "proposal_needs_attention" ? (
                  <Button size="sm" variant="outline" asChild>
                    <Link to="/proposals">See proposals</Link>
                  </Button>
                ) : n.kind === "recipe_needs_review" ? (
                  <Button size="sm" variant="outline" asChild>
                    <Link
                      to={`/suppliers/${n.supplierId}/rules`}
                      aria-label={`Review stock rules ${n.supplierName}`}
                    >
                      Review stock rules
                    </Link>
                  </Button>
                ) : (
                  <Button size="sm" asChild>
                    <Link
                      to={`/suppliers/${n.supplierId}/connect`}
                      aria-label={`Reconnect supplier ${n.supplierName}`}
                    >
                      Reconnect supplier
                    </Link>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="mb-8 grid grid-cols-2 gap-px border-y border-border bg-border lg:grid-cols-5 max-lg:[&>*:last-child:nth-child(odd)]:col-span-2">
        <SummaryCard
          title="Supplier connections"
          state={stateOf(suppliers)}
          value={supplierCard.value}
          note={supplierCard.note}
          onRetry={loadSuppliers}
          action={
            Array.isArray(suppliers) && total > 0
              ? list.some((s) => s.needsLogin && s.sessionStatus === "needs_reconnect")
                ? seeLink(
                    "/suppliers?status=needs_reconnect",
                    "See suppliers",
                    "See suppliers that need reconnecting",
                  )
                : seeLink("/suppliers", "See suppliers")
              : undefined
          }
        />
        <SummaryCard
          title="Supplier links"
          state={stateOf(links)}
          value={linkCard.value}
          note={linkCard.note}
          onRetry={loadLinks}
          action={
            links !== null && links !== "error" && links.total > 0
              ? seeLink("/mappings", "See links")
              : undefined
          }
        />
        <SummaryCard
          title="Stock answers"
          state={stateOf(links)}
          value={stockCard.value}
          note={stockCard.note}
          onRetry={loadLinks}
        >
          {links !== null && links !== "error" && answered > 0 && (
            <Split
              className="mt-1.5"
              parts={[
                ["bg-good", links.answers.in],
                ["bg-bad", links.answers.out],
                ["bg-neutral", links.answers.unsure],
              ]}
            />
          )}
        </SummaryCard>
        <SummaryCard
          title="Stock checks"
          state={stateOf(schedule)}
          value={checksCard.value}
          note={checksCard.note}
          onRetry={loadSchedule}
          action={on.length > 0 ? seeLink("/suppliers", "See automatic checks") : undefined}
        />
        <SummaryCard
          title="Waiting for your approval"
          state="ok"
          value={String(waiting)}
          note={
            waiting > 0
              ? "Suggested changes to your Shopify stock are waiting for you."
              : "Nothing to review. Proposed Shopify changes will appear here."
          }
          action={waiting > 0 ? seeLink("/proposals", "Review suggestions") : undefined}
        />
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-8">
          {Array.isArray(suppliers) && suppliers.length > 0 && (
            <section role="region" aria-labelledby="recent-heading">
              <h2
                id="recent-heading"
                className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
              >
                Suppliers · recent checks
              </h2>
              <ul className="border-t border-foreground">
                {suppliers.map((s) => {
                  const row = Array.isArray(schedule)
                    ? schedule.find((r) => r.supplierId === s.id)
                    : undefined;
                  const said = row ? recentChecksSentence(row, now) : null;
                  return (
                    <li
                      key={s.id}
                      className="grid grid-cols-[minmax(0,1fr)] gap-x-4 gap-y-0.5 border-b border-rule-soft py-2.5 text-sm sm:grid-cols-[12rem_minmax(0,1fr)_auto]"
                    >
                      <span className="font-medium">{s.name}</span>
                      {said ? (
                        <span
                          data-tone={said.tone}
                          className={
                            said.tone === "bad" ? "font-semibold text-bad" : "text-ink-soft"
                          }
                        >
                          {said.text}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          {schedule === null ? "Loading…" : "No checks yet"}
                        </span>
                      )}
                      <span className="font-mono text-muted-foreground">
                        {row?.lastRun?.endedAt ? clock(row.lastRun.endedAt) : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {newest !== null && newest.length > 0 && (
            <section role="region" aria-labelledby="newest-heading">
              <div className="mb-1 flex items-baseline justify-between gap-3">
                <h2
                  id="newest-heading"
                  className="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
                >
                  Waiting for approval
                </h2>
                <Link to="/proposals" className="text-[0.8125rem] underline underline-offset-3">
                  All {waiting} proposals
                </Link>
              </div>
              <ul className="border-t border-foreground">
                {newest.map((p) => (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-rule-soft py-2.5 text-sm"
                  >
                    <span className="min-w-0">
                      <span className="font-medium">{p.productTitle}</span>
                      <span className="cell-sub">
                        {p.variantTitle} · {p.supplierName}
                      </span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="font-mono text-xs text-muted-foreground">
                        <s>{p.shopifyQuantitySeen}</s> → {p.proposedQuantity}
                      </span>
                      <Button
                        size="sm"
                        aria-label={`Approve ${p.productTitle}`}
                        loading={approving === p.id}
                        onClick={() => approve(p)}
                      >
                        Approve
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {links !== null && links !== "error" && links.total > 0 && (
          <section aria-labelledby="links-heading" className="min-w-0">
            <h2
              id="links-heading"
              className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
            >
              Links
            </h2>
            <div className="border-y border-rule-soft py-3">
              <p className="text-sm">
                <span className="font-mono text-xl font-medium">
                  {linked.toLocaleString("en-GB")}
                </span>{" "}
                <span className="text-muted-foreground">
                  of {links.total.toLocaleString("en-GB")} variants linked to a supplier page
                </span>
              </p>
              <Split
                className="mt-2"
                parts={[
                  ["bg-foreground", linked],
                  ["bg-hover", links.unmapped],
                ]}
              />
              {links.unmapped > 0 && (
                <div className="mt-2 flex items-center justify-between gap-3 text-[0.8125rem] text-muted-foreground">
                  {links.unmapped.toLocaleString("en-GB")} still to link
                  <Button variant="outline" size="sm" asChild>
                    <Link to="/mappings">Link variants</Link>
                  </Button>
                </div>
              )}
            </div>
          </section>
        )}
      </div>

      {noSuppliers && (
        <section aria-labelledby="how-heading" className="mt-8 border-t border-border pt-4">
          <h2 id="how-heading" className="mb-3 text-base font-semibold">
            How it works
          </h2>
          <ol className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-labelledby="how-heading">
            {STEPS.map(([title, text], i) => (
              <li key={title} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="grid size-6 shrink-0 place-items-center rounded-full border border-foreground font-mono text-xs font-semibold"
                >
                  {i + 1}
                </span>
                <span className="flex flex-col">
                  <strong className="text-sm">{title}</strong>
                  <span className="text-sm text-muted-foreground">{text}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}
