import { useState, type FormEvent } from "react";
import { MAX_QUANTITY } from "@stock-monitor/proposals";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import type { ProposalSettings } from "../../api.js";
import { Field } from "../../components/Field.js";
import { Notice } from "../../components/Notice.js";
import { Panel } from "../../components/Panel.js";
import { toast } from "../../lib/toast.js";
import { useGetProposalSettingsQuery, useSaveProposalSettingsMutation } from "../../store/api/proposals/proposalApi.js";

const message = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong. Please try again.");
const whole = (text: string, min: number, max: number) => /^\d+$/.test(text.trim()) && Number(text) >= min && Number(text) <= max;

/** The two numbers behind suggestions, and whether Shopify lets this app change stock. */
export function ProposalSettingsCard() {
  const { data, error } = useGetProposalSettingsQuery();

  return (
    <Panel
      id="proposal-settings-heading"
      title="Stock suggestions"
      description="When a supplier is out of stock, the app suggests setting your Shopify number to 0. When a supplier has stock and Shopify shows 0, it suggests the quantity below. You can change that number on each suggestion before you approve it."
    >
      {data && <Notice kind={data.writePermission.state === "ready" ? "success" : "warning"}>{data.writePermission.message}</Notice>}
      {!data && !error && (
        <div className="flex flex-col gap-3">
          <p role="status" className="sr-only">
            Loading…
          </p>
          <Skeleton className="h-10 w-full max-w-xs" />
          <Skeleton className="h-10 w-full max-w-xs" />
        </div>
      )}
      {/* Mounts once the settings are here, so the fields start from them without an effect. */}
      {data && <SettingsForm initial={data.settings} />}
      {!data && error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {message(error)}
        </p>
      )}
    </Panel>
  );
}

function SettingsForm({ initial }: { initial: ProposalSettings }) {
  // What the owner types is screen state, not server data, so it stays in useState.
  const [quantity, setQuantity] = useState(String(initial.defaultQuantity));
  const [hours, setHours] = useState(String(initial.expiryHours));
  const [error, setError] = useState<string | null>(null);
  const save = useSaveProposalSettingsMutation();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!whole(quantity, 1, MAX_QUANTITY)) return setError(`Enter a whole number from 1 to ${MAX_QUANTITY} for the back-in-stock quantity.`);
    if (!whole(hours, 1, 720)) return setError("Enter a whole number of hours from 1 to 720.");
    try {
      await save.mutateAsync({ defaultQuantity: Number(quantity), expiryHours: Number(hours) });
      toast("Saved.");
    } catch (e) {
      setError(message(e));
    }
  }

  return (
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
      <div>
        <Button type="submit" loading={save.isPending}>
          Save
        </Button>
      </div>
    </form>
  );
}
