import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, type Api, type Supplier, type SupplierInput } from "../api.js";
import { Notice } from "../components/Notice.js";
import { PermissionPanel } from "../components/PermissionPanel.js";
import { Link, navigate } from "../router.js";
import { useTitle } from "../useTitle.js";

type Field = "name" | "websiteUrl" | "loginUrl" | "checkIntervalMinutes";
type Errors = Partial<Record<Field, string>>;
type Load = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; supplier: Supplier | null };

const ORDER: Field[] = ["name", "websiteUrl", "loginUrl", "checkIntervalMinutes"];
const INTERVAL_MESSAGE = "Enter a whole number of minutes from 15 to 1440.";
// The server says which field a problem belongs to. Anything else is shown above the buttons.
const FIELD_OF_CODE: Record<string, Field> = {
  invalid_name: "name",
  name_taken: "name",
  invalid_website: "websiteUrl",
  invalid_login_url: "loginUrl",
  invalid_interval: "checkIntervalMinutes",
};

const message = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong. Please try again.");

export function SupplierFormPage({ api, id }: { api: Api; id?: string }) {
  const editing = id !== undefined;
  useTitle(editing ? "Edit supplier" : "Add supplier");
  const [load, setLoad] = useState<Load>(editing ? { kind: "loading" } : { kind: "ready", supplier: null });

  useEffect(() => {
    if (id === undefined) return;
    api.suppliers
      .get(id)
      .then((supplier) => setLoad({ kind: "ready", supplier }))
      .catch((e: unknown) => setLoad({ kind: "error", message: message(e) }));
  }, [api, id]);

  return (
    <>
      <div className="page-header">
        <h1>{editing ? "Edit supplier" : "Add supplier"}</h1>
        <p className="muted">
          {editing ? "Change how this supplier is checked." : "Add a supplier website you want to check for stock."}
        </p>
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
            <Link to="/suppliers" className="button secondary">
              Back to suppliers
            </Link>
          </div>
        </>
      )}
      {load.kind === "ready" && (
        <>
          <section className="panel">
            <SupplierForm api={api} supplier={load.supplier} />
          </section>
          {load.supplier && (
            <section className="panel">
              <PermissionPanel api={api} supplier={load.supplier} />
            </section>
          )}
        </>
      )}
    </>
  );
}

function SupplierForm({ api, supplier }: { api: Api; supplier: Supplier | null }) {
  const [name, setName] = useState(supplier?.name ?? "");
  const [websiteUrl, setWebsiteUrl] = useState(supplier?.websiteUrl ?? "");
  const [loginUrl, setLoginUrl] = useState(supplier?.loginUrl ?? "");
  const [interval, setInterval] = useState(String(supplier?.checkIntervalMinutes ?? 60));
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const refs: Record<Field, React.RefObject<HTMLInputElement | null>> = {
    name: useRef<HTMLInputElement>(null),
    websiteUrl: useRef<HTMLInputElement>(null),
    loginUrl: useRef<HTMLInputElement>(null),
    checkIntervalMinutes: useRef<HTMLInputElement>(null),
  };

  const showErrors = (next: Errors) => {
    setErrors(next);
    const first = ORDER.find((f) => next[f]);
    if (first) refs[first].current?.focus();
  };

  /** Returns the cleaned values, or null after showing what is wrong beside each field. */
  function validate(): SupplierInput | null {
    const next: Errors = {};
    const minutes = Number(interval);
    if (!name.trim()) next.name = "Enter a name for the supplier.";
    if (!websiteUrl.trim()) next.websiteUrl = "Enter the supplier's website address, starting with https://.";
    if (!/^\d+$/.test(interval.trim()) || minutes < 15 || minutes > 1440) next.checkIntervalMinutes = INTERVAL_MESSAGE;
    if (Object.keys(next).length > 0) {
      showErrors(next);
      return null;
    }
    return { name: name.trim(), websiteUrl: websiteUrl.trim(), loginUrl: loginUrl.trim() || null, checkIntervalMinutes: minutes };
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    setErrors({});
    const values = validate();
    if (!values) return;

    // When editing, send only what changed. Nothing changed means there is nothing to save.
    const patch: Partial<SupplierInput> = supplier
      ? Object.fromEntries(
          (Object.entries(values) as [keyof SupplierInput, SupplierInput[keyof SupplierInput]][]).filter(([k, v]) => supplier[k] !== v),
        )
      : values;
    if (supplier && Object.keys(patch).length === 0) return navigate("/suppliers");

    setSaving(true);
    try {
      await (supplier ? api.suppliers.update(supplier.id, patch) : api.suppliers.create(values));
      navigate("/suppliers");
    } catch (error) {
      const field = error instanceof ApiError && error.code ? FIELD_OF_CODE[error.code] : undefined;
      if (field) showErrors({ [field]: message(error) });
      else setFormError(message(error));
      setSaving(false);
    }
  }

  const field = (
    key: Field,
    label: string,
    value: string,
    set: (v: string) => void,
    opts: { hint: string; type?: string; inputMode?: "numeric" | "url" },
  ) => {
    const error = errors[key];
    return (
      <div className="field">
        <label htmlFor={key}>{label}</label>
        <input
          id={key}
          ref={refs[key]}
          type={opts.type ?? "text"}
          inputMode={opts.inputMode}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={value}
          onChange={(e) => set(e.target.value)}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={`${key}-hint${error ? ` ${key}-error` : ""}`}
        />
        <p id={`${key}-hint`} className="hint">
          {opts.hint}
        </p>
        {error && (
          <p id={`${key}-error`} className="field-error">
            {error}
          </p>
        )}
      </div>
    );
  };

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="connect-form">
      {field("name", "Name", name, setName, { hint: "How you want to see this supplier in the app." })}
      {field("websiteUrl", "Website address", websiteUrl, setWebsiteUrl, {
        hint: "Starting with https://, like https://shop.example.com.",
        inputMode: "url",
      })}
      {field("loginUrl", "Login address (optional)", loginUrl, setLoginUrl, {
        hint: "Where the supplier's login page is, if it is not the website above. You log in yourself: this app never asks for or stores a supplier password.",
        inputMode: "url",
      })}
      {field("checkIntervalMinutes", "Check every (minutes)", interval, setInterval, {
        hint: "How often to check for stock, from 15 to 1440 minutes.",
        type: "number",
        inputMode: "numeric",
      })}

      {formError && (
        <Notice kind="error" role="alert">
          {formError}
        </Notice>
      )}

      <div className="actions">
        <button type="submit" className="button primary" disabled={saving}>
          {saving ? (supplier ? "Saving…" : "Adding…") : supplier ? "Save changes" : "Add supplier"}
        </button>
        <Link to="/suppliers" className="button secondary">
          Cancel
        </Link>
      </div>
    </form>
  );
}
