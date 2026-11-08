import { useEffect, useState } from "react";
import type { Api, ShopifyConnection, ShopifyLocation } from "../../api.js";
import { Notice } from "../../components/Notice.js";

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
  const [saved, setSaved] = useState<string | null>(null);
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
    setSaved(null);
    try {
      const location = await api.shopify.chooseLocation(id);
      onChosen(location);
      setSaved(`Using ${location.name}.`);
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
    <section className="panel" aria-labelledby="location-heading">
      <h2 id="location-heading">Inventory location</h2>
      <p className="muted">
        Stock is read from one location in Shopify. Pick the one that holds the stock you sell.
      </p>

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

      {locations && locations.length === 0 && <p>No active locations were found in Shopify.</p>}

      {locations && locations.length > 0 && (
        <div className="field">
          <label htmlFor="location">Location</label>
          <select
            id="location"
            value={connection.locationId ?? ""}
            onChange={(e) => void choose(e.target.value)}
            disabled={saving}
          >
            <option value="">Choose a location</option>
            {savedMissing && <option value={connection.locationId!}>{connection.locationName ?? "Saved location"}</option>}
            {options.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div aria-live="polite">{saved && <Notice kind="success">{saved}</Notice>}</div>
    </section>
  );
}
