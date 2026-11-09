import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, type Api, type Mapping, type Supplier, type UnmappedVariant } from "../api.js";
import { Notice } from "../components/Notice.js";
import { Link, navigate } from "../router.js";
import { useTitle } from "../useTitle.js";

type Field = "variant" | "supplier" | "url" | "note";
type Errors = Partial<Record<Field, string>>;
type Load = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; mapping: Mapping | null };

const ORDER: Field[] = ["variant", "supplier", "url", "note"];
const FIELD_OF_CODE: Record<string, Field> = {
  variant_not_found: "variant",
  already_mapped: "variant",
  supplier_not_found: "supplier",
  invalid_url: "url",
  wrong_site: "url",
  invalid_note: "note",
};
const message = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong. Please try again.");

export function MappingFormPage({ api, id }: { api: Api; id?: string }) {
  const editing = id !== undefined;
  useTitle(editing ? "Edit link" : "Add link");
  const [load, setLoad] = useState<Load>(editing ? { kind: "loading" } : { kind: "ready", mapping: null });

  useEffect(() => {
    if (id === undefined) return;
    api.mappings
      .get(id)
      .then((mapping) => setLoad({ kind: "ready", mapping }))
      .catch((e: unknown) => setLoad({ kind: "error", message: message(e) }));
  }, [api, id]);

  return (
    <>
      <div className="page-header">
        <h1>{editing ? "Edit link" : "Add link"}</h1>
        <p className="muted">{editing ? "Change the supplier page this variant is linked to." : "Link a Shopify variant to the same item on a supplier's website."}</p>
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
            <Link to="/mappings" className="button secondary">
              Back to links
            </Link>
          </div>
        </>
      )}
      {load.kind === "ready" && (
        <section className="panel">
          <MappingForm api={api} mapping={load.mapping} />
        </section>
      )}
    </>
  );
}

function MappingForm({ api, mapping }: { api: Api; mapping: Mapping | null }) {
  const preselected = new URLSearchParams(window.location.search).get("variant") ?? "";
  const [variantId, setVariantId] = useState(preselected);
  const [supplierId, setSupplierId] = useState("");
  const [url, setUrl] = useState(mapping?.url ?? "");
  const [note, setNote] = useState(mapping?.note ?? "");
  const [find, setFind] = useState("");
  const [variants, setVariants] = useState<UnmappedVariant[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const refs: Record<Field, React.RefObject<HTMLInputElement | HTMLSelectElement | null>> = {
    variant: useRef<HTMLSelectElement>(null),
    supplier: useRef<HTMLSelectElement>(null),
    url: useRef<HTMLInputElement>(null),
    note: useRef<HTMLInputElement>(null),
  };

  useEffect(() => {
    api.suppliers.list().then(setSuppliers).catch((e: unknown) => setFormError(message(e)));
  }, [api]);
  useEffect(() => {
    if (mapping) return;
    const timer = setTimeout(() => {
      api.mappings.unmapped(find || undefined).then((r) => setVariants(r.items)).catch((e: unknown) => setFormError(message(e)));
    }, 250);
    return () => clearTimeout(timer);
  }, [api, find, mapping]);

  const showErrors = (next: Errors) => {
    setErrors(next);
    const first = ORDER.find((f) => next[f]);
    if (first) refs[first].current?.focus();
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    setErrors({});
    const trimmed = url.trim();
    const next: Errors = {};
    if (!mapping && !variantId) next.variant = "Choose the variant this link is for.";
    if (!mapping && !supplierId) next.supplier = "Choose the supplier.";
    if (!trimmed) next.url = "Enter the address of the supplier's page, starting with https://.";
    if (Object.keys(next).length > 0) return showErrors(next);

    setSaving(true);
    try {
      if (mapping) {
        const patch: { url?: string; note?: string | null } = {};
        if (trimmed !== mapping.url) patch.url = trimmed;
        if ((note.trim() || null) !== mapping.note) patch.note = note.trim() || null;
        if (Object.keys(patch).length > 0) await api.mappings.update(mapping.id, patch);
      } else {
        await api.mappings.create({ variantId, supplierId, url: trimmed, note: note.trim() || null });
      }
      navigate("/mappings");
    } catch (error) {
      const field = error instanceof ApiError && error.code ? FIELD_OF_CODE[error.code] : undefined;
      if (field) showErrors({ [field]: message(error) });
      else setFormError(message(error));
      setSaving(false);
    }
  }

  const err = (key: Field) =>
    errors[key] && (
      <p id={`${key}-error`} className="field-error">
        {errors[key]}
      </p>
    );
  const described = (key: Field) => (errors[key] ? { "aria-invalid": "true" as const, "aria-describedby": `${key}-error` } : {});

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="connect-form">
      {mapping ? (
        <>
          <div className="field">
            <p className="label">Variant</p>
            <p>
              {mapping.productTitle} · {mapping.variantTitle}
            </p>
          </div>
          <div className="field">
            <p className="label">Supplier</p>
            <p>{mapping.supplierName}</p>
          </div>
        </>
      ) : (
        <>
          <div className="field">
            <label htmlFor="find">Find a variant</label>
            <input id="find" type="search" autoComplete="off" value={find} onChange={(e) => setFind(e.target.value)} />
            <p className="hint">Search by product, variant or SKU. Only variants with no link are listed.</p>
          </div>
          <div className="field">
            <label htmlFor="variant">Variant</label>
            <select id="variant" ref={refs.variant as React.RefObject<HTMLSelectElement>} value={variantId} onChange={(e) => setVariantId(e.target.value)} {...described("variant")}>
              <option value="">Choose a variant</option>
              {variantId && !variants.some((v) => v.variantId === variantId) && <option value={variantId}>Selected variant</option>}
              {variants.map((v) => (
                <option key={v.variantId} value={v.variantId}>
                  {v.productTitle} · {v.variantTitle}
                  {v.sku ? ` · ${v.sku}` : ""}
                </option>
              ))}
            </select>
            {err("variant")}
          </div>
          <div className="field">
            <label htmlFor="supplier">Supplier</label>
            <select id="supplier" ref={refs.supplier as React.RefObject<HTMLSelectElement>} value={supplierId} onChange={(e) => setSupplierId(e.target.value)} {...described("supplier")}>
              <option value="">Choose a supplier</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            {err("supplier")}
          </div>
        </>
      )}

      <div className="field">
        <label htmlFor="url">Supplier page address</label>
        <input id="url" ref={refs.url as React.RefObject<HTMLInputElement>} type="text" inputMode="url" autoComplete="off" autoCapitalize="none" spellCheck={false} value={url} onChange={(e) => setUrl(e.target.value)} {...described("url")} />
        <p className="hint">
          The page for this exact item, on the supplier's own website, starting with https://.
          {mapping && " Changing the address starts the link's history again."}
        </p>
        {err("url")}
      </div>
      <div className="field">
        <label htmlFor="note">Note (optional)</label>
        <input id="note" ref={refs.note as React.RefObject<HTMLInputElement>} type="text" autoComplete="off" value={note} onChange={(e) => setNote(e.target.value)} {...described("note")} />
        {err("note")}
      </div>

      {formError && (
        <Notice kind="error" role="alert">
          {formError}
        </Notice>
      )}
      <div className="actions">
        <button type="submit" className="button primary" disabled={saving}>
          {saving ? "Saving…" : mapping ? "Save changes" : "Add link"}
        </button>
        <Link to="/mappings" className="button secondary">
          Cancel
        </Link>
      </div>
    </form>
  );
}
