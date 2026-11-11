import { useEffect, useState } from "react";
import type { Api, Supplier } from "../api.js";
import { Notice } from "../components/Notice.js";
import { Link } from "../router.js";
import { useTitle } from "../useTitle.js";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Connecting a supplier with a login made in the owner's own browser: they export that site's cookies as JSON and paste them here.
 * The pasted text is credentials. It lives only in this component's state and is dropped as soon as it is saved.
 */
export function ImportLoginPage({ api, supplierId }: { api: Api; supplierId: string }) {
  useTitle("Import login");
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ kept: number; dropped: number } | null>(null);

  useEffect(() => {
    api.suppliers.get(supplierId).then(setSupplier, () => {});
  }, [api, supplierId]);

  async function save() {
    if (busy || !text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { kept, dropped } = await api.loginSessions.importCookies(supplierId, text);
      setText("");
      setDone({ kept, dropped });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-header">
        <h1>{supplier ? `Import login for ${supplier.name}` : "Import login"}</h1>
        <p className="muted">Use a login you made in your own browser instead of the login window.</p>
      </div>

      {done ? (
        <>
          <Notice kind="success" role="status">
            Saved {plural(done.kept, "cookie")}
            {done.dropped > 0 ? `, ignored ${done.dropped} from other sites` : ""}. Checking the connection now.
          </Notice>
          <div className="actions">
            <Link to="/suppliers" className="button primary inline">
              Back to suppliers
            </Link>
          </div>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <ol>
            <li>Log in to the supplier in your normal browser.</li>
            <li>With a cookie extension (such as Cookie-Editor), export that site's cookies as JSON.</li>
            <li>Paste the whole text below and press Import login.</li>
          </ol>
          {error && (
            <Notice kind="error" role="alert">
              {error}
            </Notice>
          )}
          <div className="field">
            <label htmlFor="cookie-export">Cookie export (JSON)</label>
            <textarea id="cookie-export" rows={8} value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" spellCheck={false} />
            <p className="muted">These cookies are a login. They are saved encrypted and are never shown again.</p>
          </div>
          <div className="actions">
            <button type="submit" className="button primary" disabled={busy || !text.trim()}>
              Import login
            </button>
            <Link to="/suppliers" className="button secondary">
              Cancel
            </Link>
          </div>
        </form>
      )}
    </>
  );
}
