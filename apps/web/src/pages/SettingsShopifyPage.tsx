import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import type { Api, ConnectionCheck, ShopifyConnection, ShopifyDetails } from "../api.js";
import { Notice } from "../components/Notice.js";
import { PageHeader } from "../components/PageHeader.js";
import { Panel } from "../components/Panel.js";
import { useTitle } from "../useTitle.js";
import { ConnectionCard } from "./settings/ConnectionCard.js";
import { LocationCard } from "./settings/LocationCard.js";
import { ShopifyConnectForm } from "./settings/ShopifyConnectForm.js";
import { ProposalSettingsCard } from "./settings/ProposalSettingsCard.js";
import { SyncCard } from "./settings/SyncCard.js";

type Load =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; connection: ShopifyConnection | null };

export function SettingsShopifyPage({ api }: { api: Api }) {
  useTitle("Settings");
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
      <PageHeader title="Settings" description="Your Shopify store and how stock suggestions work." />

      <div className="flex max-w-3xl flex-col gap-6">
        {load.kind === "loading" && (
          <>
            <p role="status" className="sr-only">
              Loading…
            </p>
            <Skeleton className="h-48 w-full rounded-xl" />
            <Skeleton className="h-32 w-full rounded-xl" />
          </>
        )}

        {load.kind === "error" && (
          <div className="flex flex-col items-start gap-3">
            <Notice kind="error" role="alert">
              {load.message}
            </Notice>
            <Button onClick={read}>Try again</Button>
          </div>
        )}

        {load.kind === "ready" && load.connection === null && (
          <Panel
            id="connect-heading"
            title="Connect your Shopify store"
            description="Connecting lets this app read your products and stock. It only changes a stock number when you approve a suggestion, and only if you have given the app permission to change inventory. In your Shopify admin, create an app with read access to products and inventory, then copy its client ID and secret here."
          >
            <ShopifyConnectForm onTest={(details) => api.shopify.test(details)} onConnect={connect} />
          </Panel>
        )}

        {load.kind === "ready" && load.connection && (
          <>
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
            <ProposalSettingsCard api={api} />
          </>
        )}
      </div>
    </>
  );
}
