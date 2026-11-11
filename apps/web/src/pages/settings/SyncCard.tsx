import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button.js";
import type { Api, ShopifyConnection, SyncRun } from "../../api.js";
import { Notice } from "../../components/Notice.js";
import { Panel } from "../../components/Panel.js";
import { formatWhen } from "../../format.js";

type Props = {
  api: Api;
  connection: ShopifyConnection;
  /** Called when a sync has finished, so the page can read the connection again. */
  onFinished: () => void;
};

const POLL_MS = 2000;
const GIVE_UP_AFTER_POLLS = 15; // about 30 seconds without the worker picking the job up

type Phase = "idle" | "waiting" | "running";

const message = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong. Please try again.");

export function SyncCard({ api, connection, onFinished }: Props) {
  const [lastRun, setLastRun] = useState<SyncRun | null | undefined>(undefined);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notStarted, setNotStarted] = useState(false);

  // The poll runs from a timer, so it reads the latest values through refs.
  const phaseRef = useRef<Phase>("idle");
  const baselineRef = useRef(0);
  const pollsRef = useRef(0);
  const finishedRef = useRef(onFinished);
  finishedRef.current = onFinished;
  const move = (next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  };

  useEffect(() => {
    let current = true;
    api.shopify
      .getSync()
      .then((run) => {
        if (!current) return;
        setLastRun(run);
        if (run?.status === "running") move("running");
      })
      .catch((e: unknown) => current && (setLastRun(null), setError(message(e))));
    return () => {
      current = false;
    };
  }, [api]);

  useEffect(() => {
    if (phase === "idle") return;
    const timer = setInterval(async () => {
      try {
        const run = await api.shopify.getSync();
        setLastRun(run);
        if (phaseRef.current === "waiting") {
          if (run && run.id > baselineRef.current) {
            if (run.status === "running") move("running");
            else {
              move("idle");
              finishedRef.current();
            }
          } else {
            pollsRef.current += 1;
            if (pollsRef.current >= GIVE_UP_AFTER_POLLS) {
              move("idle");
              setNotStarted(true);
            }
          }
        } else if (phaseRef.current === "running" && run && run.status !== "running") {
          move("idle");
          finishedRef.current();
        }
      } catch {
        // A single failed poll is not a failed sync. Try again on the next tick.
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [api, phase]);

  async function start() {
    setError(null);
    setNotStarted(false);
    baselineRef.current = lastRun?.id ?? 0;
    pollsRef.current = 0;
    move("waiting");
    try {
      await api.shopify.startSync();
    } catch (e) {
      move("idle");
      setError(message(e));
    }
  }

  const needsReconnect = connection.status === "needs_reconnect";
  const hint = needsReconnect
    ? "Reconnect Shopify first."
    : !connection.locationId
      ? "Choose an inventory location first."
      : null;
  const busy = phase !== "idle";
  // Until the last run is known, a run that already exists could be mistaken for the one just started.
  const loadingLastRun = lastRun === undefined;

  const progress = () => {
    if (phase === "waiting") return "Starting the sync…";
    if (phase === "running" || lastRun?.status === "running") {
      return `Checking your store… ${lastRun?.total ?? 0} variants so far.`;
    }
    if (lastRun === undefined) return "Loading…";
    if (!lastRun) return "Nothing has been synced yet.";
    if (lastRun.status === "succeeded") {
      return (
        `Last sync finished ${formatWhen(lastRun.finishedAt ?? lastRun.startedAt)}: ${lastRun.total ?? 0} variants. ` +
        `${lastRun.added ?? 0} new, ${lastRun.updated ?? 0} updated, ${lastRun.unchanged ?? 0} unchanged, ${lastRun.removed ?? 0} removed.`
      );
    }
    return `Last sync failed ${formatWhen(lastRun.finishedAt ?? lastRun.startedAt)}.`;
  };

  return (
    <Panel id="sync-heading" title="Sync" description="Copies your products and the stock at the chosen location into this app. It only reads from Shopify.">
      {error && (
        <Notice kind="error" role="alert">
          {error}
        </Notice>
      )}
      {notStarted && <Notice kind="warning">The sync has not started yet. Make sure the background worker is running, then try again.</Notice>}

      <div role="status" aria-label="Sync progress" className="text-sm">
        {progress()}
      </div>
      {!busy && lastRun?.status === "failed" && lastRun.error && <Notice kind="error">{lastRun.error}</Notice>}
      {!busy && lastRun?.status === "succeeded" && lastRun.links && (
        <div className="flex flex-col gap-2 text-sm">
          <p>{`Links from Shopify: ${lastRun.links.added} added, ${lastRun.links.updated} updated, ${lastRun.links.skipped} skipped.`}</p>
          {lastRun.links.problems.length > 0 && (
            <>
              <p className="text-muted-foreground">Skipped. Fix these in Shopify, then sync again.</p>
              <ul className="flex flex-col gap-1">
                {lastRun.links.problems.map((p, i) => (
                  <li key={i}>
                    {p.product}
                    {p.sku ? ` (${p.sku})` : ""}: {p.message}
                  </li>
                ))}
              </ul>
              {lastRun.links.skipped > lastRun.links.problems.length && <p className="text-muted-foreground">Showing the first {lastRun.links.problems.length}.</p>}
            </>
          )}
        </div>
      )}

      <div>
        <Button onClick={() => void start()} disabled={busy || hint !== null || loadingLastRun} loading={busy}>
          {busy ? "Syncing…" : "Sync from Shopify"}
        </Button>
      </div>
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
    </Panel>
  );
}
