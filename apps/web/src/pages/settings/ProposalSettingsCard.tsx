import { useEffect, useState, type FormEvent } from "react";
import { MAX_QUANTITY } from "@stock-monitor/proposals";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import type { Api, WritePermission } from "../../api.js";
import { Field } from "../../components/Field.js";
import { Notice } from "../../components/Notice.js";
import { Panel } from "../../components/Panel.js";

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
    <Panel
      id="proposal-settings-heading"
      title="Stock suggestions"
      description="When a supplier is out of stock, the app suggests setting your Shopify number to 0. When a supplier has stock and Shopify shows 0, it suggests the quantity below. You can change that number on each suggestion before you approve it."
    >
      {permission && <Notice kind={permission.state === "ready" ? "success" : "warning"}>{permission.message}</Notice>}
      {!loaded && !error && (
        <div className="flex flex-col gap-3">
          <p role="status" className="sr-only">
            Loading…
          </p>
          <Skeleton className="h-10 w-full max-w-xs" />
          <Skeleton className="h-10 w-full max-w-xs" />
        </div>
      )}
      {loaded && (
        <form onSubmit={(e) => void submit(e)} noValidate className="flex max-w-xs flex-col gap-4">
          <Field id="proposal-quantity" label="Quantity for back-in-stock suggestions">
            <Input id="proposal-quantity" inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </Field>
          <Field id="proposal-hours" label="Hours a suggestion stays open">
            <Input id="proposal-hours" inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value)} />
          </Field>
          {error && (
            <p role="alert" className="text-sm font-medium text-danger">
              {error}
            </p>
          )}
          {saved && <p role="status" className="text-sm font-medium text-success">Saved.</p>}
          <div>
            <Button type="submit" loading={saving}>
              Save
            </Button>
          </div>
        </form>
      )}
      {!loaded && error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </Panel>
  );
}
