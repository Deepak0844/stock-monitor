import { useState } from "react";
import type { Api, Supplier } from "../api.js";
import { Notice } from "./Notice.js";

const message = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong. Please try again.");

/**
 * Whether the supplier's product pages need a login. Off, the app checks them with no saved login at all: no connecting,
 * automatic login or keep-alive. Turning it off keeps a saved login, so turning it on again restores it.
 */
export function NeedsLoginCard({ api, supplier, onChange }: { api: Api; supplier: Supplier; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(needsLogin: boolean) {
    setBusy(true);
    setError(null);
    try {
      await api.suppliers.setNeedsLogin(supplier.id, needsLogin);
      onChange();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="needs-login-title" className="flex max-w-xl flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="needs-login-title" className="text-lg font-semibold">
            Login
          </h2>
          <p id="needs-login-hint" className="text-sm text-muted-foreground">
            Off when the supplier's product pages show stock without logging in.
          </p>
          {!supplier.needsLogin && <p className="text-sm font-medium">Checked without logging in</p>}
        </div>
        <label className="flex min-h-11 shrink-0 items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            role="switch"
            aria-label="Needs a login"
            aria-describedby="needs-login-hint"
            className="size-5 accent-primary disabled:opacity-60"
            checked={supplier.needsLogin}
            disabled={busy}
            onChange={(e) => void toggle(e.target.checked)}
          />
          {supplier.needsLogin ? "Needed" : "Not needed"}
        </label>
      </div>
      {error && (
        <Notice kind="error" role="alert">
          {error}
        </Notice>
      )}
    </section>
  );
}
