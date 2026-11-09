import { useState, type FormEvent } from "react";
import type { Api, Supplier } from "../api.js";
import { Notice } from "./Notice.js";

const WORDS: Record<Supplier["automationPermission"], string> = { unknown: "Not recorded", granted: "Allowed", not_granted: "Not allowed" };
const MEANING: Record<Supplier["automationPermission"], string> = {
  unknown: "Link checks stay off until you record that this supplier allows automatic checks.",
  granted: "Link checks are on for this supplier.",
  not_granted: "Link checks stay off for this supplier.",
};
const message = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong. Please try again.");

/**
 * The owner's record of whether a supplier allows automatic checks, and how long to wait between two pages. A reminder and a
 * record, not a legal control: the owner sets it. Link checks refuse a supplier that is not recorded as allowed.
 */
export function PermissionPanel({ api, supplier }: { api: Api; supplier: Supplier }) {
  const [status, setStatus] = useState(supplier.automationPermission);
  const [note, setNote] = useState(supplier.permissionNote ?? "");
  const [pause, setPause] = useState(String(supplier.checkPauseSeconds));
  const [pauseError, setPauseError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    const seconds = Number(pause);
    if (!/^\d+$/.test(pause.trim()) || seconds < 1 || seconds > 3600) return setPauseError("Enter a whole number of seconds from 1 to 3600.");
    setPauseError(null);
    setSaving(true);
    try {
      const updated = await api.suppliers.setPermission(supplier.id, { status, note: note.trim() || null, pauseSeconds: seconds });
      setStatus(updated.automationPermission);
      setSaved(true);
    } catch (e) {
      setError(message(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="connect-form">
      <fieldset role="group" aria-label="Permission to check automatically">
        <legend>Permission to check automatically</legend>
        <p className="muted">
          Many suppliers' terms limit automatic checks. Record what you have agreed with this supplier. Status: <strong>{WORDS[status]}</strong>. {MEANING[status]}
          {supplier.permissionSetAt ? ` Last recorded ${new Date(supplier.permissionSetAt).toLocaleDateString()}.` : ""}
        </p>
        <div className="field">
          <label htmlFor="permission">Permission</label>
          <select id="permission" value={status} onChange={(e) => setStatus(e.target.value as Supplier["automationPermission"])}>
            <option value="unknown">Not recorded</option>
            <option value="granted">Allowed</option>
            <option value="not_granted">Not allowed</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="permission-note">Note about the permission (optional)</label>
          <input id="permission-note" type="text" autoComplete="off" value={note} onChange={(e) => setNote(e.target.value)} />
          <p className="hint">For example: who you asked and when.</p>
        </div>
        <div className="field">
          <label htmlFor="pause">Pause between pages (seconds)</label>
          <input id="pause" type="number" inputMode="numeric" value={pause} onChange={(e) => setPause(e.target.value)} aria-invalid={pauseError ? "true" : undefined} aria-describedby={pauseError ? "pause-error" : "pause-hint"} />
          <p id="pause-hint" className="hint">
            How long to wait between two pages of this supplier. Use at least the delay its robots.txt asks for.
          </p>
          {pauseError && (
            <p id="pause-error" className="field-error">
              {pauseError}
            </p>
          )}
        </div>
        {error && (
          <Notice kind="error" role="alert">
            {error}
          </Notice>
        )}
        <div aria-live="polite">{saved && <Notice kind="success" role="status">Permission saved.</Notice>}</div>
        <div className="actions">
          <button type="submit" className="button secondary" disabled={saving}>
            Save permission
          </button>
        </div>
      </fieldset>
    </form>
  );
}

/** The region stock checks look for on this supplier's pages, unless a link has its own. */
export function RegionPanel({ api, supplier }: { api: Api; supplier: Supplier }) {
  const [region, setRegion] = useState(supplier.defaultRegion ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      await api.suppliers.setRegion(supplier.id, region.trim() || null);
      setSaved(true);
    } catch (e) {
      setError(message(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="connect-form">
      <h2>Region for stock checks</h2>
      <div className="field">
        <label htmlFor="default-region">Default region (optional)</label>
        <input id="default-region" type="text" autoComplete="off" value={region} onChange={(e) => setRegion(e.target.value)} />
        <p className="hint">For a supplier that lists stock by region: the region's name as the supplier writes it. A link can have its own region. Leave empty if the supplier has no regions.</p>
      </div>
      {error && (
        <Notice kind="error" role="alert">
          {error}
        </Notice>
      )}
      <div aria-live="polite">{saved && <Notice kind="success" role="status">Region saved.</Notice>}</div>
      <div className="actions">
        <button type="submit" className="button secondary" disabled={saving}>
          Save region
        </button>
      </div>
    </form>
  );
}
