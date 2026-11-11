import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button.js";
import { Card } from "@/components/ui/card.js";
import { Input } from "@/components/ui/input.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import { ApiError, type Api, type Supplier, type SupplierInput } from "../api.js";
import { Field as FormField } from "../components/Field.js";
import { Notice } from "../components/Notice.js";
import { PageHeader } from "../components/PageHeader.js";
import { PermissionPanel, RegionPanel } from "../components/PermissionPanel.js";
import { SchedulePanel } from "../components/SchedulePanel.js";
import { Link, navigate } from "../router.js";
import { useTitle } from "../useTitle.js";

type Field = "name" | "websiteUrl" | "loginUrl";
type Errors = Partial<Record<Field, string>>;
type Load = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; supplier: Supplier | null };

const ORDER: Field[] = ["name", "websiteUrl", "loginUrl"];
// The server says which field a problem belongs to. Anything else is shown above the buttons.
const FIELD_OF_CODE: Record<string, Field> = {
  invalid_name: "name",
  name_taken: "name",
  invalid_website: "websiteUrl",
  invalid_login_url: "loginUrl",
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
      <PageHeader
        title={editing ? "Edit supplier" : "Add supplier"}
        description={editing ? "Change how this supplier is checked." : "Add a supplier website you want to check for stock."}
      />

      {load.kind === "loading" && (
        <Card className="flex max-w-2xl flex-col gap-4 p-6">
          <p role="status" className="sr-only">
            Loading…
          </p>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-2/3" />
        </Card>
      )}
      {load.kind === "error" && (
        <div className="flex max-w-2xl flex-col items-start gap-3">
          <Notice kind="error" role="alert">
            {load.message}
          </Notice>
          <Button variant="outline" asChild>
            <Link to="/suppliers">Back to suppliers</Link>
          </Button>
        </div>
      )}
      {load.kind === "ready" && (
        <div className="flex max-w-2xl flex-col gap-6">
          <Card className="p-6">
            <SupplierForm api={api} supplier={load.supplier} />
          </Card>
          {load.supplier && (
            <>
              <Card className="p-6">
                <PermissionPanel api={api} supplier={load.supplier} />
              </Card>
              <Card className="p-6">
                <RegionPanel api={api} supplier={load.supplier} />
              </Card>
              <Card className="p-6">
                <SchedulePanel api={api} supplier={load.supplier} />
              </Card>
            </>
          )}
        </div>
      )}
    </>
  );
}

function SupplierForm({ api, supplier }: { api: Api; supplier: Supplier | null }) {
  const [name, setName] = useState(supplier?.name ?? "");
  const [websiteUrl, setWebsiteUrl] = useState(supplier?.websiteUrl ?? "");
  const [loginUrl, setLoginUrl] = useState(supplier?.loginUrl ?? "");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const refs: Record<Field, React.RefObject<HTMLInputElement | null>> = {
    name: useRef<HTMLInputElement>(null),
    websiteUrl: useRef<HTMLInputElement>(null),
    loginUrl: useRef<HTMLInputElement>(null),
  };

  const showErrors = (next: Errors) => {
    setErrors(next);
    const first = ORDER.find((f) => next[f]);
    if (first) refs[first].current?.focus();
  };

  /** Returns the cleaned values, or null after showing what is wrong beside each field. */
  function validate(): SupplierInput | null {
    const next: Errors = {};
    if (!name.trim()) next.name = "Enter a name for the supplier.";
    if (!websiteUrl.trim()) next.websiteUrl = "Enter the supplier's website address, starting with https://.";
    if (Object.keys(next).length > 0) {
      showErrors(next);
      return null;
    }
    return { name: name.trim(), websiteUrl: websiteUrl.trim(), loginUrl: loginUrl.trim() || null };
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
      <FormField id={key} label={label} hint={<span id={`${key}-hint`}>{opts.hint}</span>} error={error}>
        <Input
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
      </FormField>
    );
  };

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-5">
      {field("name", "Name", name, setName, { hint: "How you want to see this supplier in the app." })}
      {field("websiteUrl", "Website address", websiteUrl, setWebsiteUrl, {
        hint: "Starting with https://, like https://shop.example.com.",
        inputMode: "url",
      })}
      {field("loginUrl", "Login address (optional)", loginUrl, setLoginUrl, {
        hint: "Where the supplier's login page is, if it is not the website above. You log in yourself: this app never asks for or stores a supplier password.",
        inputMode: "url",
      })}

      {formError && (
        <Notice kind="error" role="alert">
          {formError}
        </Notice>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={saving}>
          {saving ? (supplier ? "Saving…" : "Adding…") : supplier ? "Save changes" : "Add supplier"}
        </Button>
        <Button variant="outline" asChild>
          <Link to="/suppliers">Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
