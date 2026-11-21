import { useState } from "react";
import { Button } from "@/components/ui/button.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import type { Api, ConnectionCheck, ShopifyConnection, ShopifyDetails } from "../api.js";
import { Notice } from "../components/Notice.js";
import { Panel } from "../components/Panel.js";
import { useTitle } from "../useTitle.js";
import { useConnectShopifyMutation, useGetShopifyConnectionQuery, useShopifyRefresh } from "../store/api/shopify/shopifyApi.js";
import { ConnectionCard } from "./settings/ConnectionCard.js";
import { LocationCard } from "./settings/LocationCard.js";
import { ShopifyConnectForm } from "./settings/ShopifyConnectForm.js";
import { SyncCard } from "./settings/SyncCard.js";

type Load =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; connection: ShopifyConnection | null };

export function SettingsShopifyPage({ api }: { api: Api }) {
  useTitle("Settings");
  const connection = useGetShopifyConnectionQuery();
  const load: Load =
    connection.data !== undefined
      ? { kind: "ready", connection: connection.data }
      : connection.isError && !connection.isFetching
        ? { kind: "error", message: connection.error instanceof Error ? connection.error.message : "Something went wrong. Please try again." }
        : { kind: "loading" };
  const read = () => void connection.refetch();
  const [welcome, setWelcome] = useState<ConnectionCheck | null>(null);

  /** Reads the connection and the products again without showing "Loading…", for example after a sync. */
  const refresh = useShopifyRefresh();
  const connectShopify = useConnectShopifyMutation();

  async function connect(details: ShopifyDetails) {
    setWelcome(await connectShopify.mutateAsync(details));
  }

  return (
    <>
      <div className="flex flex-col">
        {load.kind === "loading" && (
          <>
            <p role="status" className="sr-only">
              Loading…
            </p>
            <Skeleton className="h-48 w-full rounded-md" />
            <Skeleton className="h-32 w-full rounded-md" />
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
              onDisconnected={() => setWelcome(null)}
            />
            {load.connection.status === "connected" && (
              <LocationCard connection={load.connection} />
            )}
            <SyncCard api={api} connection={load.connection} onFinished={refresh} />
          </>
        )}
      </div>
    </>
  );
}
