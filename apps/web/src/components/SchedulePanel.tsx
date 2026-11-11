import { useEffect, useState, type FormEvent } from "react";
import { DEFAULT_WINDOW } from "@stock-monitor/scheduling";
import { Button } from "@/components/ui/button.js";
import { Input, Select } from "@/components/ui/input.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import type { Api, CheckRun, ScheduleRow, Supplier } from "../api.js";
import { Field } from "./Field.js";
import { Notice } from "./Notice.js";
import { INTERVAL_CHOICES, runSummary, whenWords } from "./scheduleWords.js";

const message = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong. Please try again.");

/**
 * Automatic checks for one supplier: how often, and the hours of the day they may start. Off until the owner turns it on. The
 * run history sits beneath it. The checks themselves still follow the supplier's permission, pause and stock rules.
 */
export function SchedulePanel({ api, supplier }: { api: Api; supplier: Supplier }) {
  const on = supplier.scheduleIntervalMinutes !== null;
  const [interval, setInterval] = useState<string>(on ? String(supplier.scheduleIntervalMinutes) : "off");
  const [anyTime, setAnyTime] = useState(on && supplier.scheduleWindowStart === null);
  const [from, setFrom] = useState(supplier.scheduleWindowStart ?? DEFAULT_WINDOW.start);
  const [until, setUntil] = useState(supplier.scheduleWindowEnd ?? DEFAULT_WINDOW.end);
  const [row, setRow] = useState<ScheduleRow | null>(null);
  const [runs, setRuns] = useState<CheckRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = () => {
    api.schedule.overview().then((rows) => setRow(rows.find((r) => r.supplierId === supplier.id) ?? null)).catch(() => {});
    api.schedule.runs(supplier.id).then(setRuns).catch(() => setRuns([]));
  };
  useEffect(load, [api, supplier.id]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    if (!anyTime && from === until) return setError("Choose a start and an end time that are different.");
    setSaving(true);
    try {
      await api.schedule.set(supplier.id, { intervalMinutes: interval === "off" ? null : Number(interval), window: anyTime ? null : { start: from, end: until } });
      setSaved(true);
      load();
    } catch (e) {
      setError(message(e));
    } finally {
      setSaving(false);
    }
  }

  const status = row?.status;
  return (
    <div className="flex max-w-xl flex-col gap-4">
      <form onSubmit={(e) => void submit(e)} noValidate>
        <fieldset role="group" aria-label="Automatic checks" className="flex flex-col gap-4">
          <legend className="mb-1 text-lg font-semibold">Automatic checks</legend>
          <p className="text-sm text-muted-foreground">
            Check this supplier's stock by itself. It only runs when the supplier is connected, running, recorded as allowed and has stock rules turned on. If the supplier asks you to log in again or shows a puzzle, the checks stop and wait for you.
          </p>
          <Field id="schedule-interval" label="How often">
            <Select id="schedule-interval" className="w-full" value={interval} onChange={(e) => setInterval(e.target.value)}>
              {INTERVAL_CHOICES.map((c) => (
                <option key={c.words} value={c.minutes === null ? "off" : String(c.minutes)}>
                  {c.words}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex flex-col gap-1.5">
            <span id="hours-label" className="text-sm font-semibold">
              Hours of the day when a check may start (your time)
            </span>
            <div className="flex flex-wrap items-center gap-3" role="group" aria-labelledby="hours-label">
              <label htmlFor="schedule-from" className="text-sm">
                From
              </label>
              <Input id="schedule-from" className="w-auto" type="time" value={from} disabled={anyTime} onChange={(e) => setFrom(e.target.value)} />
              <label htmlFor="schedule-until" className="text-sm">
                Until
              </label>
              <Input id="schedule-until" className="w-auto" type="time" value={until} disabled={anyTime} onChange={(e) => setUntil(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-primary" checked={anyTime} onChange={(e) => setAnyTime(e.target.checked)} /> Any time of day
            </label>
            <p className="text-sm text-muted-foreground">A check that comes due outside these hours waits until they start.</p>
          </div>
          {status?.state === "waiting" && row?.nextCheckAt && <p className="text-sm">Next check: {whenWords(row.nextCheckAt)}</p>}
          {status?.state === "running" && row?.run && (
            <p role="status" className="text-sm">
              {runSummary(row.run)}
            </p>
          )}
          {status?.state === "not_checked" && (
            <Notice kind="info" role="status">
              This supplier is not being checked automatically. {status.message}
            </Notice>
          )}
          {error && (
            <Notice kind="error" role="alert">
              {error}
            </Notice>
          )}
          <div aria-live="polite">{saved && <Notice kind="success" role="status">Automatic checks saved.</Notice>}</div>
          <div>
            <Button type="submit" variant="outline" loading={saving}>
              Save automatic checks
            </Button>
          </div>
        </fieldset>
      </form>
      <h3 className="mt-2 text-base font-semibold">Recent checks</h3>
      {runs === null ? (
        <div className="flex flex-col gap-2">
          <p role="status" className="sr-only">
            Loading…
          </p>
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-2/3" />
        </div>
      ) : runs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No checks have run yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm" aria-label="Recent checks">
            <thead>
              <tr>
                {["When", "Started", "Result"].map((h) => (
                  <th key={h} scope="col" className="bg-muted/60 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-3 py-2">{whenWords(r.startedAt)}</td>
                  <td className="px-3 py-2">{r.trigger === "manual" ? "By you" : "Scheduled"}</td>
                  <td className="px-3 py-2">{runSummary(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
