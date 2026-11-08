import { useCallback, useEffect, useState } from "react";
import type { Api, ConnectionCheck, ShopifyConnection, ShopifyDetails } from "../api.js";
import { Notice } from "../components/Notice.js";
import { useTitle } from "../useTitle.js";
import { ConnectionCard } from "./settings/ConnectionCard.js";
import { LocationCard } from "./settings/LocationCard.js";
import { ShopifyConnectForm } from "./settings/ShopifyConnectForm.js";
import { SyncCard } from "./settings/SyncCard.js";

type Load =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; connection: ShopifyConnection | null };

export function SettingsShopifyPage({ api }: { api: Api }) {
  useTitle("Shopify settings");
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [welcome, setWelcome] = useState<ConnectionCheck | null>(null);

  const read = useCallback(() => {
    setLoad({ kind: "loading" });
    api.shopify
      .getConnection()
      .then((connection) => setLoad({ kind: "ready", connection }))
      .catch((e: unknown) =>
        setLoad({ kind: "error", message: e instanceof Error ? e.message : "Something went wrong. Please try again." }),
      );
  }, [api]);

  useEffect(read, [read]);

  /** Reads the connection again without showing "Loading…", for example after a sync. */
  const refresh = useCallback(() => {
    api.shopify
      .getConnection()
      .then((connection) => setLoad({ kind: "ready", connection }))
      .catch(() => {});
  }, [api]);

  async function connect(details: ShopifyDetails) {
    const result = await api.shopify.connect(details);
    setWelcome(result);
    setLoad({ kind: "ready", connection: result.connection });
  }

  return (
    <>
      <div className="page-header">
        <h1>Shopify settings</h1>
        <p className="muted">Connect your store so this app can read your products and stock.</p>
      </div>

      {load.kind === "loading" && (
        <p role="status" className="status">
          Loading…
        </p>
      )}

      {load.kind === "error" && (
        <>
          <Notice kind="error" role="alert">
            {load.message}
          </Notice>
          <div className="actions">
            <button type="button" className="button primary" onClick={read}>
              Try again
            </button>
          </div>
        </>
      )}

      {load.kind === "ready" && load.connection === null && (
        <section className="panel" aria-labelledby="connect-heading">
          <h2 id="connect-heading">Connect your Shopify store</h2>
          <p className="muted">
            Connecting lets this app read your products and stock. It never changes anything in Shopify. In your Shopify
            admin, create an app with read access to products and inventory, then copy its client ID and secret here.
          </p>
          <ShopifyConnectForm onTest={(details) => api.shopify.test(details)} onConnect={connect} />
        </section>
      )}

      {load.kind === "ready" && load.connection && (
        <div className="stack">
          <ConnectionCard
            api={api}
            connection={load.connection}
            welcome={welcome}
            onConnected={connect}
            onDisconnected={() => {
              setWelcome(null);
              setLoad({ kind: "ready", connection: null });
            }}
          />
          {load.connection.status === "connected" && (
            <LocationCard
              api={api}
              connection={load.connection}
              onChosen={(location) =>
                setLoad((current) =>
                  current.kind === "ready" && current.connection
                    ? { kind: "ready", connection: { ...current.connection, locationId: location.id, locationName: location.name } }
                    : current,
                )
              }
            />
          )}
          <SyncCard api={api} connection={load.connection} onFinished={refresh} />
        </div>
      )}
    </>
  );
}
