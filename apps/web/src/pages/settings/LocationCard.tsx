import { useEffect, useState } from "react";
import { Select } from "@/components/ui/input.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import type { Api, ShopifyConnection, ShopifyLocation } from "../../api.js";
import { Field } from "../../components/Field.js";
import { Notice } from "../../components/Notice.js";
import { Panel } from "../../components/Panel.js";
import { toast } from "../../lib/toast.js";

type Props = {
  api: Api;
  connection: ShopifyConnection;
  onChosen: (location: ShopifyLocation) => void;
};

const message = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong. Please try again.");

export function LocationCard({ api, connection, onChosen }: Props) {
  const [locations, setLocations] = useState<ShopifyLocation[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    api.shopify
      .locations()
      .then((list) => current && setLocations(list))
      .catch((e: unknown) => current && setLoadError(message(e)));
    return () => {
      current = false;
    };
  }, [api]);

  async function choose(id: string) {
    if (!id) return;
    setSaving(true);
    setError(null);
    try {
      const location = await api.shopify.chooseLocation(id);
      onChosen(location);
      toast(`Using ${location.name}.`);
    } catch (e) {
      setError(message(e));
    } finally {
      setSaving(false);
    }
  }

  // If the saved location is not in Shopify's list any more, still show it so the page tells the truth.
  const options = locations ?? [];
  const savedMissing = connection.locationId && !options.some((l) => l.id === connection.locationId);

  return (
    <Panel id="location-heading" title="Inventory location" description="Stock is read from one location in Shopify. Pick the one that holds the stock you sell.">
      {loadError && (
        <Notice kind="error" role="alert">
          {loadError}
        </Notice>
      )}
      {error && (
        <Notice kind="error" role="alert">
          {error}
        </Notice>
      )}

      {locations === null && !loadError && <Skeleton className="h-10 w-full max-w-sm" />}
      {locations && locations.length === 0 && <p className="text-sm">No active locations were found in Shopify.</p>}

      {locations && locations.length > 0 && (
        <div className="max-w-sm">
          <Field id="location" label="Location">
            <Select id="location" className="w-full" value={connection.locationId ?? ""} onChange={(e) => void choose(e.target.value)} disabled={saving}>
              <option value="">Choose a location</option>
              {savedMissing && <option value={connection.locationId!}>{connection.locationName ?? "Saved location"}</option>}
              {options.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      )}

    </Panel>
  );
}
