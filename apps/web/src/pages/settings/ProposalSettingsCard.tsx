import { useEffect, useState, type FormEvent } from "react";
import { MAX_QUANTITY } from "@stock-monitor/proposals";
import type { Api, WritePermission } from "../../api.js";
import { Notice } from "../../components/Notice.js";

const message = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong. Please try again.");
const whole = (text: string, min: number, max: number) => /^\d+$/.test(text.trim()) && Number(text) >= min && Number(text) <= max;

/** The two numbers behind suggestions, and whether Shopify lets this app change stock. */
export function ProposalSettingsCard({ api }: { api: Api }) {
  const [quantity, setQuantity] = useState("");
  const [hours, setHours] = useState("");
  const [permission, setPermission] = useState<WritePermission | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.proposals
      .settings()
      .then((r) => {
        setQuantity(String(r.settings.defaultQuantity));
        setHours(String(r.settings.expiryHours));
        setPermission(r.writePermission);
        setLoaded(true);
      })
      .catch((e: unknown) => setError(message(e)));
  }, [api]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaved(false);
    setError(null);
    if (!whole(quantity, 1, MAX_QUANTITY)) return setError(`Enter a whole number from 1 to ${MAX_QUANTITY} for the back-in-stock quantity.`);
    if (!whole(hours, 1, 720)) return setError("Enter a whole number of hours from 1 to 720.");
    setSaving(true);
    try {
      const r = await api.proposals.saveSettings({ defaultQuantity: Number(quantity), expiryHours: Number(hours) });
      setPermission(r.writePermission);
      setSaved(true);
    } catch (e) {
      setError(message(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel" aria-labelledby="proposal-settings-heading">
      <h2 id="proposal-settings-heading">Stock suggestions</h2>
      <p className="muted">
        When a supplier is out of stock, the app suggests setting your Shopify number to 0. When a supplier has stock and Shopify shows 0, it suggests the quantity below. You can change that number on each suggestion before you approve it.
      </p>
      {permission && <Notice kind={permission.state === "ready" ? "success" : "warning"}>{permission.message}</Notice>}
      {!loaded && !error && <p role="status" className="status">Loading…</p>}
      {loaded && (
        <form onSubmit={(e) => void submit(e)} noValidate>
          <div className="field">
            <label htmlFor="proposal-quantity">Quantity for back-in-stock suggestions</label>
            <input id="proposal-quantity" inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="proposal-hours">Hours a suggestion stays open</label>
            <input id="proposal-hours" inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value)} />
          </div>
          {error && (
            <p role="alert" className="field-error">
              {error}
            </p>
          )}
          {saved && <p role="status">Saved.</p>}
          <div className="actions">
            <button type="submit" className="button primary" disabled={saving}>
              Save
            </button>
          </div>
        </form>
      )}
      {!loaded && error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
    </section>
  );
}
