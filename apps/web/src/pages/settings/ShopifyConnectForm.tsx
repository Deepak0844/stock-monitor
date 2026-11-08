import { useRef, useState, type FormEvent } from "react";
import { ApiError, type ConnectionCheck, type ShopifyDetails } from "../../api.js";
import { Notice } from "../../components/Notice.js";

type Props = {
  /** The store address may be filled in. The client id, secret and token never are. */
  initialShop?: string;
  onTest: (details: ShopifyDetails) => Promise<ConnectionCheck>;
  onConnect: (details: ShopifyDetails) => Promise<void>;
  onCancel?: () => void;
};

type Errors = { shop?: string; clientId?: string; clientSecret?: string; accessToken?: string };

const SHOP_MESSAGE = "Enter your store address, like my-store.myshopify.com.";

export function ShopifyConnectForm({ initialShop = "", onTest, onConnect, onCancel }: Props) {
  const [shop, setShop] = useState(initialShop);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [tokenMode, setTokenMode] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [check, setCheck] = useState<ConnectionCheck | null>(null);
  const [busy, setBusy] = useState<"test" | "connect" | null>(null);

  const refs = {
    shop: useRef<HTMLInputElement>(null),
    clientId: useRef<HTMLInputElement>(null),
    clientSecret: useRef<HTMLInputElement>(null),
    accessToken: useRef<HTMLInputElement>(null),
  };

  /** Returns the details to send, or null after showing what is missing beside each field. */
  function validate(): ShopifyDetails | null {
    const next: Errors = {};
    const trimmedShop = shop.trim().toLowerCase(); // store addresses are not case sensitive
    if (!trimmedShop) next.shop = SHOP_MESSAGE;
    if (tokenMode) {
      if (!accessToken.trim()) next.accessToken = "Enter the access token.";
    } else {
      if (!clientId.trim()) next.clientId = "Enter the client ID.";
      if (!clientSecret.trim()) next.clientSecret = "Enter the client secret.";
    }
    setErrors(next);
    const first = (["shop", "clientId", "clientSecret", "accessToken"] as const).find((k) => next[k]);
    if (first) {
      refs[first].current?.focus();
      return null;
    }
    return tokenMode
      ? { shop: trimmedShop, accessToken: accessToken.trim() }
      : { shop: trimmedShop, clientId: clientId.trim(), clientSecret: clientSecret.trim() };
  }

  async function run(kind: "test" | "connect") {
    setCheck(null);
    setFormError(null);
    const details = validate();
    if (!details) return;
    setBusy(kind);
    try {
      if (kind === "test") {
        setCheck(await onTest(details));
      } else {
        await onConnect(details);
        // The secret is not kept once it has been sent.
        setClientId("");
        setClientSecret("");
        setAccessToken("");
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === "invalid_shop") {
        setErrors({ shop: error.message });
        refs.shop.current?.focus();
      } else {
        setFormError(error instanceof Error ? error.message : "Something went wrong. Please try again.");
      }
    } finally {
      setBusy(null);
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run("connect");
  };

  const switchMode = () => {
    setTokenMode((m) => !m);
    setErrors({});
    setFormError(null);
    setCheck(null);
  };

  const field = (
    id: keyof Errors,
    label: string,
    value: string,
    set: (v: string) => void,
    opts: { secret?: boolean; hint?: string } = {},
  ) => {
    const error = errors[id];
    const describedBy = [opts.hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
    return (
      <div className="field">
        <label htmlFor={id}>{label}</label>
        <input
          id={id}
          ref={refs[id]}
          type={opts.secret ? "password" : "text"}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={value}
          onChange={(e) => set(e.target.value)}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={describedBy}
        />
        {opts.hint && (
          <p id={`${id}-hint`} className="hint">
            {opts.hint}
          </p>
        )}
        {error && (
          <p id={`${id}-error`} className="field-error">
            {error}
          </p>
        )}
      </div>
    );
  };

  return (
    <form onSubmit={submit} noValidate className="connect-form">
      {field("shop", "Store address", shop, setShop, { hint: "Your store's address, like my-store.myshopify.com." })}
      {tokenMode ? (
        field("accessToken", "Access token", accessToken, setAccessToken, { secret: true })
      ) : (
        <>
          {field("clientId", "Client ID", clientId, setClientId)}
          {field("clientSecret", "Client secret", clientSecret, setClientSecret, { secret: true })}
        </>
      )}

      <button type="button" className="link-button" onClick={switchMode}>
        {tokenMode ? "Use a client ID and secret instead" : "Use an older permanent access token instead"}
      </button>

      <div className="form-result" aria-live="polite">
        {check && (
          <Notice kind="success" role="status">
            Connection works. Store name: {check.shopName}.
          </Notice>
        )}
        {check && check.warnings.length > 0 && (
          <ul className="warning-list">
            {check.warnings.map((w) => (
              <li key={w}>
                <Notice kind="warning">{w}</Notice>
              </li>
            ))}
          </ul>
        )}
      </div>

      {formError && (
        <Notice kind="error" role="alert">
          {formError}
        </Notice>
      )}

      <div className="actions">
        <button type="button" className="button secondary" onClick={() => void run("test")} disabled={busy !== null}>
          {busy === "test" ? "Testing…" : "Test connection"}
        </button>
        <button type="submit" className="button primary" disabled={busy !== null} aria-busy={busy === "connect"}>
          {busy === "connect" ? "Connecting…" : "Connect"}
        </button>
        {onCancel && (
          <button type="button" className="button secondary" onClick={onCancel} disabled={busy !== null}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
