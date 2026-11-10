import { useEffect, useState, type FormEvent } from "react";
import { DEFAULT_WINDOW } from "@stock-monitor/scheduling";
import type { Api, CheckRun, ScheduleRow, Supplier } from "../api.js";
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
    <div className="connect-form">
      <form onSubmit={(e) => void submit(e)} noValidate>
        <fieldset role="group" aria-label="Automatic checks">
          <legend>Automatic checks</legend>
          <p className="muted">
            Check this supplier's stock by itself. It only runs when the supplier is connected, running, recorded as allowed and has stock rules turned on. If the supplier asks you to log in again or shows a puzzle, the checks stop and wait for you.
          </p>
          <div className="field">
            <label htmlFor="schedule-interval">How often</label>
            <select id="schedule-interval" value={interval} onChange={(e) => setInterval(e.target.value)}>
              {INTERVAL_CHOICES.map((c) => (
                <option key={c.words} value={c.minutes === null ? "off" : String(c.minutes)}>
                  {c.words}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <span id="hours-label">Hours of the day when a check may start (your time)</span>
            <div className="row-actions" role="group" aria-labelledby="hours-label">
              <label htmlFor="schedule-from" className="inline-label">From</label>
              <input id="schedule-from" type="time" value={from} disabled={anyTime} onChange={(e) => setFrom(e.target.value)} />
              <label htmlFor="schedule-until" className="inline-label">Until</label>
              <input id="schedule-until" type="time" value={until} disabled={anyTime} onChange={(e) => setUntil(e.target.value)} />
            </div>
            <label className="check-label">
              <input type="checkbox" checked={anyTime} onChange={(e) => setAnyTime(e.target.checked)} /> Any time of day
            </label>
            <p className="hint">A check that comes due outside these hours waits until they start.</p>
          </div>
          {status?.state === "waiting" && row?.nextCheckAt && <p>Next check: {whenWords(row.nextCheckAt)}</p>}
          {status?.state === "running" && row?.run && <p role="status">{runSummary(row.run)}</p>}
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
          <div className="actions">
            <button type="submit" className="button secondary" disabled={saving}>
              Save automatic checks
            </button>
          </div>
        </fieldset>
      </form>
      <h3>Recent checks</h3>
      {runs === null ? (
        <p role="status" className="status">Loading…</p>
      ) : runs.length === 0 ? (
        <p className="muted">No checks have run yet.</p>
      ) : (
        <table className="data-table" aria-label="Recent checks">
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Started</th>
              <th scope="col">Result</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td data-label="When">{whenWords(r.startedAt)}</td>
                <td data-label="Started">{r.trigger === "manual" ? "By you" : "Scheduled"}</td>
                <td data-label="Result">{runSummary(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
