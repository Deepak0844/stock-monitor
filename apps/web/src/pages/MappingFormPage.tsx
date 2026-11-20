import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import { ApiError, type Api, type Mapping, type Supplier, type UnmappedVariant } from "../api.js";
import { Field, ReadOnlyField } from "../components/Field.js";
import { Notice } from "../components/Notice.js";
import { PageHeader } from "../components/PageHeader.js";
import { SearchSelect } from "../components/SearchSelect.js";
import { Link, navigate } from "../router.js";
import { useTitle } from "../useTitle.js";
import { useGetSupplierListQuery } from "../store/api/suppliers/supplierApi.js";

type Field = "variant" | "supplier" | "url" | "note" | "region" | "supplierOption";
type Errors = Partial<Record<Field, string>>;
type Load = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; mapping: Mapping | null };

const ORDER: Field[] = ["variant", "supplier", "url", "note", "region", "supplierOption"];
const FIELD_OF_CODE: Record<string, Field> = {
  variant_not_found: "variant",
  already_mapped: "variant",
  supplier_not_found: "supplier",
  invalid_url: "url",
  wrong_site: "url",
  invalid_note: "note",
  invalid_region: "region",
  invalid_supplier_option: "supplierOption",
};
const NO_SUPPLIERS: Supplier[] = [];
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
      <PageHeader
        back={{ to: "/mappings", label: "Back to links" }}
        title={editing ? "Edit link" : "Add link"}
        description={editing ? "Change the supplier page this variant is linked to." : "Link a Shopify variant to the same item on a supplier's website."}
      />
      {load.kind === "loading" && (
        <section className="flex max-w-2xl flex-col gap-4 border-t border-border py-6 first:border-t-0 first:pt-2 max-w-3xl">
          <p role="status" className="sr-only">
            Loading…
          </p>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-2/3" />
        </section>
      )}
      {load.kind === "error" && (
        <div className="flex max-w-2xl flex-col items-start gap-3">
          <Notice kind="error" role="alert">
            {load.message}
          </Notice>
          <Button variant="outline" asChild>
            <Link to="/mappings">Back to links</Link>
          </Button>
        </div>
      )}
      {load.kind === "ready" && (
        <section className="flex max-w-2xl flex-col gap-4 border-t border-border py-6 first:border-t-0 first:pt-2 max-w-3xl">
          {load.mapping?.shopifyManaged && (
            <Notice kind="warning">
              This link is set from Shopify, from the supplier name and page address on the product. If you change it here, the next Sync puts Shopify's supplier and page address back. Change them in Shopify instead.
            </Notice>
          )}
          <MappingForm api={api} mapping={load.mapping} />
        </section>
      )}
    </>
  );
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

function MappingForm({ api, mapping }: { api: Api; mapping: Mapping | null }) {
  const preselected = new URLSearchParams(window.location.search).get("variant") ?? "";
  const [variantId, setVariantId] = useState(preselected);
  const [supplierId, setSupplierId] = useState("");
  const [url, setUrl] = useState(mapping?.url ?? "");
  const [note, setNote] = useState(mapping?.note ?? "");
  const [region, setRegion] = useState(mapping?.region ?? "");
  const [supplierOption, setSupplierOption] = useState(mapping?.supplierOption ?? "");
  const [variants, setVariants] = useState<UnmappedVariant[]>([]);
  const supplierList = useGetSupplierListQuery();
  const suppliers = supplierList.data ?? NO_SUPPLIERS;
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // The two pickers are dropdowns with search; they are found by their field id to be focused on an error.
  const byId = (id: string) => ({ get current() { return document.getElementById(id); } });
  const refs: Record<Field, { current: HTMLElement | null }> = {
    variant: byId("variant"),
    supplier: byId("supplier"),
    url: useRef<HTMLInputElement>(null),
    note: useRef<HTMLInputElement>(null),
    region: useRef<HTMLInputElement>(null),
    supplierOption: useRef<HTMLInputElement>(null),
  };

  useEffect(() => {
    if (supplierList.error) setFormError(message(supplierList.error));
  }, [supplierList.error]);
  // The first variants with no link, so a variant chosen from the Map button shows by name.
  useEffect(() => {
    if (mapping) return;
    api.mappings
      .unmapped()
      .then((r) => setVariants(r.items))
      .catch((e: unknown) => setFormError(message(e)));
  }, [api, mapping]);
  const variantOption = (v: UnmappedVariant) => ({ id: v.variantId, label: `${v.productTitle} · ${v.variantTitle}`, detail: v.sku ?? undefined });
  const searchVariants = useCallback(
    (q: string) =>
      api.mappings.unmapped(q || undefined).then((r) => {
        setVariants((known) => [...known, ...r.items.filter((v) => !known.some((k) => k.variantId === v.variantId))]);
        return r.items.map(variantOption);
      }),
    [api],
  );
  const chosenVariant = variants.find((v) => v.variantId === variantId);

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
        const patch: { url?: string; note?: string | null; region?: string | null; supplierOption?: string | null } = {};
        if (trimmed !== mapping.url) patch.url = trimmed;
        if ((note.trim() || null) !== mapping.note) patch.note = note.trim() || null;
        if ((region.trim() || null) !== mapping.region) patch.region = region.trim() || null;
        if ((supplierOption.trim() || null) !== mapping.supplierOption) patch.supplierOption = supplierOption.trim() || null;
        if (Object.keys(patch).length > 0) await api.mappings.update(mapping.id, patch);
      } else {
        await api.mappings.create({ variantId, supplierId, url: trimmed, note: note.trim() || null, ...(region.trim() ? { region: region.trim() } : {}), ...(supplierOption.trim() ? { supplierOption: supplierOption.trim() } : {}) });
      }
      navigate("/mappings");
    } catch (error) {
      const field = error instanceof ApiError && error.code ? FIELD_OF_CODE[error.code] : undefined;
      if (field) showErrors({ [field]: message(error) });
      else setFormError(message(error));
      setSaving(false);
    }
  }

  const described = (key: Field) => (errors[key] ? { "aria-invalid": "true" as const, "aria-describedby": `${key}-error` } : {});

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-5">
      {mapping ? (
        <>
          <ReadOnlyField label="Variant">
            {mapping.productTitle} · {mapping.variantTitle}
          </ReadOnlyField>
          <ReadOnlyField label="Supplier">{mapping.supplierName}</ReadOnlyField>
        </>
      ) : (
        <>
          <Field id="variant" label="Variant" hint="Search by product, variant or SKU. Only variants with no link are listed." error={errors.variant}>
            <SearchSelect
              id="variant"
              label="Variant"
              hideLabel
              value={variantId || null}
              valueLabel={chosenVariant ? `${chosenVariant.productTitle} · ${chosenVariant.variantTitle}` : variantId ? "Selected variant" : "Choose a variant"}
              search={searchVariants}
              placeholder="Search variants"
              noMatch={(text) => (text ? `No variant with no link matches "${text}".` : "Every variant has a link.")}
              onChange={(id) => setVariantId(id ?? "")}
              invalid={Boolean(errors.variant)}
              describedBy={errors.variant ? "variant-error" : undefined}
              className="w-full"
            />
          </Field>
          <Field id="supplier" label="Supplier" error={errors.supplier}>
            <SearchSelect
              id="supplier"
              label="Supplier"
              hideLabel
              value={supplierId || null}
              valueLabel={suppliers.find((x) => x.id === supplierId)?.name ?? "Choose a supplier"}
              options={suppliers.map((x) => ({ id: x.id, label: x.name, detail: hostOf(x.websiteUrl) }))}
              placeholder="Search suppliers"
              noMatch={(text) => `No supplier matches "${text}".`}
              onChange={(id) => setSupplierId(id ?? "")}
              invalid={Boolean(errors.supplier)}
              describedBy={errors.supplier ? "supplier-error" : undefined}
              className="w-full"
            />
          </Field>
        </>
      )}

      <Field
        id="url"
        label="Supplier page address"
        error={errors.url}
        hint={
          <>
            The page for this exact item, on the supplier's own website, starting with https://.
            {mapping && " Changing the address starts the link's history again."}
          </>
        }
      >
        <Input id="url" ref={refs.url as React.RefObject<HTMLInputElement>} type="text" inputMode="url" autoComplete="off" autoCapitalize="none" spellCheck={false} value={url} onChange={(e) => setUrl(e.target.value)} {...described("url")} />
      </Field>
      <Field id="note" label="Note (optional)" error={errors.note}>
        <Input id="note" ref={refs.note as React.RefObject<HTMLInputElement>} type="text" autoComplete="off" value={note} onChange={(e) => setNote(e.target.value)} {...described("note")} />
      </Field>
      <Field
        id="region"
        label="Region (optional)"
        error={errors.region}
        hint="For suppliers that list stock by region: the region's name as the supplier writes it. Left empty, the supplier's default region is used."
      >
        <Input id="region" ref={refs.region as React.RefObject<HTMLInputElement>} type="text" autoComplete="off" value={region} onChange={(e) => setRegion(e.target.value)} {...described("region")} />
      </Field>
      <Field
        id="supplierOption"
        label="Option on the supplier's page (optional)"
        error={errors.supplierOption}
        hint="Only needed when the supplier's page lists several sizes or colours with different stock. Copy the option name or the supplier's SKU from the saved page."
      >
        <Input
          id="supplierOption"
          ref={refs.supplierOption as React.RefObject<HTMLInputElement>}
          type="text"
          autoComplete="off"
          value={supplierOption}
          onChange={(e) => setSupplierOption(e.target.value)}
          {...described("supplierOption")}
        />
      </Field>

      {formError && (
        <Notice kind="error" role="alert">
          {formError}
        </Notice>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={saving}>
          {mapping ? "Save changes" : "Add link"}
        </Button>
        <Button variant="outline" asChild>
          <Link to="/mappings">Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
