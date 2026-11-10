import { useRef, useState } from "react";
import type { Api, ConnectionCheck, ShopifyConnection, ShopifyDetails } from "../../api.js";
import { Notice } from "../../components/Notice.js";
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
  const [busy, setBusy] = useState<"test" | "disconnect" | null>(null);
  const [check, setCheck] = useState<ConnectionCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

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
    setBusy("disconnect");
    setError(null);
    try {
      await api.shopify.disconnect();
      onDisconnected();
    } catch (e) {
      setError(message(e));
      setConfirming(false);
    } finally {
      setBusy(null);
    }
  }

  const shown = check ?? welcome;

  return (
    <section className="panel" aria-labelledby="connection-heading">
      <h2 id="connection-heading">Connection</h2>

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

      <dl className="facts">
        <div>
          <dt>Store</dt>
          <dd>{connection.shop}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>
            <span className={needsReconnect ? "status-badge warn" : "status-badge ok"}>
              {needsReconnect ? "Needs reconnecting" : "Connected"}
            </span>
          </dd>
        </div>
        <div>
          <dt>Permissions</dt>
          <dd>
            {connection.scopes.length > 0 ? (
              <ul className="chips">
                {connection.scopes.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            ) : (
              "Not checked"
            )}
          </dd>
        </div>
        <div>
          <dt>Connected since</dt>
          <dd>{formatWhen(connection.connectedAt)}</dd>
        </div>
        <div>
          <dt>Last successful check</dt>
          <dd>{connection.lastSuccessfulCallAt ? formatWhen(connection.lastSuccessfulCallAt) : "Not yet"}</dd>
        </div>
      </dl>

      {shown && (
        <div className="form-result" aria-live="polite">
          {check && (
            <Notice kind="success" role="status">
              Connection works. Store name: {check.shopName}.
            </Notice>
          )}
          {shown.warnings.length > 0 && (
            <ul className="warning-list">
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
        <div className="subpanel">
          <h3>Reconnect Shopify</h3>
          <p className="muted">For your safety the saved client ID and secret are never shown, so enter them again.</p>
          <ShopifyConnectForm
            initialShop={connection.shop}
            onTest={(details) => api.shopify.test(details)}
            onConnect={async (details) => {
              await onConnected(details);
              setShowForm(false);
            }}
            onCancel={needsReconnect ? undefined : () => setShowForm(false)}
          />
        </div>
      ) : confirming ? (
        <div className="subpanel" role="group" aria-label="Confirm disconnect">
          <p>
            <strong>Disconnect Shopify?</strong> The saved credentials will be deleted. Products already imported stay in
            this app.
          </p>
          <div className="actions">
            <button type="button" className="button danger" onClick={() => void disconnect()} disabled={busy !== null}>
              Yes, disconnect
            </button>
            <button type="button" className="button secondary" ref={cancelRef} onClick={() => setConfirming(false)} disabled={busy !== null}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="actions">
          {needsReconnect ? (
            <button type="button" className="button primary" onClick={() => setShowForm(true)}>
              Reconnect Shopify
            </button>
          ) : (
            <>
              <button type="button" className="button secondary" onClick={() => void test()} disabled={busy !== null}>
                {busy === "test" ? "Testing…" : "Test connection"}
              </button>
              <button type="button" className="button secondary" onClick={() => setShowForm(true)}>
                Reconnect Shopify
              </button>
            </>
          )}
          <button
            type="button"
            className="button secondary"
            onClick={() => {
              setConfirming(true);
              queueMicrotask(() => cancelRef.current?.focus());
            }}
          >
            Disconnect
          </button>
        </div>
      )}
    </section>
  );
}
