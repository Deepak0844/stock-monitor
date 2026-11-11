import { useState } from "react";
import { Badge } from "@/components/ui/badge.js";
import { Button } from "@/components/ui/button.js";
import type { Api, ConnectionCheck, ShopifyConnection, ShopifyDetails } from "../../api.js";
import { ConfirmDialog } from "../../components/ConfirmDialog.js";
import { Notice } from "../../components/Notice.js";
import { Facts, Panel, SubPanel } from "../../components/Panel.js";
import { formatWhen } from "../../format.js";
import { ShopifyConnectForm } from "./ShopifyConnectForm.js";

type Props = {
  api: Api;
  connection: ShopifyConnection;
  /** Shown once, right after connecting. */
  welcome: ConnectionCheck | null;
  onConnected: (details: ShopifyDetails) => Promise<void>;
  onDisconnected: () => void;
};

const message = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong. Please try again.");

export function ConnectionCard({ api, connection, welcome, onConnected, onDisconnected }: Props) {
  const needsReconnect = connection.status === "needs_reconnect";
  const [showForm, setShowForm] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<"test" | null>(null);
  const [check, setCheck] = useState<ConnectionCheck | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function test() {
    setBusy("test");
    setError(null);
    setCheck(null);
    try {
      setCheck(await api.shopify.test());
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    await api.shopify.disconnect();
    onDisconnected();
  }

  const shown = check ?? welcome;

  return (
    <Panel id="connection-heading" title="Connection">
      {welcome && (
        <Notice kind="success" role="status">
          Connected to {welcome.shopName}.
        </Notice>
      )}
      {needsReconnect && (
        <Notice kind="error" role="alert">
          Shopify rejected the saved connection. Reconnect Shopify.
        </Notice>
      )}
      {error && (
        <Notice kind="error" role="alert">
          {error}
        </Notice>
      )}

      <Facts
        items={[
          ["Store", connection.shop],
          ["Status", <Badge variant={needsReconnect ? "warning" : "success"}>{needsReconnect ? "Needs reconnecting" : "Connected"}</Badge>],
          [
            "Permissions",
            connection.scopes.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5">
                {connection.scopes.map((s) => (
                  <li key={s} className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs">
                    {s}
                  </li>
                ))}
              </ul>
            ) : (
              "Not checked"
            ),
          ],
          ["Connected since", formatWhen(connection.connectedAt)],
          ["Last successful check", connection.lastSuccessfulCallAt ? formatWhen(connection.lastSuccessfulCallAt) : "Not yet"],
        ]}
      />

      {shown && (
        <div className="flex flex-col gap-2" aria-live="polite">
          {check && (
            <Notice kind="success" role="status">
              Connection works. Store name: {check.shopName}.
            </Notice>
          )}
          {shown.warnings.length > 0 && (
            <ul className="flex flex-col gap-2">
              {shown.warnings.map((w) => (
                <li key={w}>
                  <Notice kind="warning">{w}</Notice>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {showForm ? (
        <SubPanel>
          <h3 className="font-semibold">Reconnect Shopify</h3>
          <p className="text-sm text-muted-foreground">For your safety the saved client ID and secret are never shown, so enter them again.</p>
          <ShopifyConnectForm
            initialShop={connection.shop}
            onTest={(details) => api.shopify.test(details)}
            onConnect={async (details) => {
              await onConnected(details);
              setShowForm(false);
            }}
            onCancel={needsReconnect ? undefined : () => setShowForm(false)}
          />
        </SubPanel>
      ) : (
        <div className="flex flex-wrap gap-2">
          {needsReconnect ? (
            <Button onClick={() => setShowForm(true)}>Reconnect Shopify</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => void test()} disabled={busy !== null} loading={busy === "test"}>
                {busy === "test" ? "Testing…" : "Test connection"}
              </Button>
              <Button variant="outline" onClick={() => setShowForm(true)}>
                Reconnect Shopify
              </Button>
            </>
          )}
          <Button variant="outline" onClick={() => setConfirming(true)}>
            Disconnect
          </Button>
        </div>
      )}

      {confirming && (
        <ConfirmDialog
          open
          title="Disconnect Shopify?"
          description="The saved credentials will be deleted. Products already imported stay in this app."
          confirmLabel="Disconnect Shopify"
          onConfirm={disconnect}
          onClose={() => setConfirming(false)}
        />
      )}
    </Panel>
  );
}
