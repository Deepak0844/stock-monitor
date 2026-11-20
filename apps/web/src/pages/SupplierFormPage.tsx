import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import { ApiError, type Api, type Supplier, type SupplierInput } from "../api.js";
import { AutoLoginCard } from "../components/AutoLoginCard.js";
import { NeedsLoginCard } from "../components/NeedsLoginCard.js";
import { Field as FormField } from "../components/Field.js";
import { Notice } from "../components/Notice.js";
import { PageHeader } from "../components/PageHeader.js";
import { PermissionPanel, RegionPanel } from "../components/PermissionPanel.js";
import { SchedulePanel } from "../components/SchedulePanel.js";
import { Link, navigate } from "../router.js";
import { useTitle } from "../useTitle.js";
import {
  useCreateSupplierMutation,
  useGetSupplierQuery,
  useSupplierRefresh,
  useUpdateSupplierMutation,
} from "../store/api/suppliers/supplierApi.js";
import { Badge } from "@/components/ui/badge.js";
import { When } from "../components/When.js";
import { statusOf } from "./SuppliersPage.js";

const host = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

type Field = "name" | "shopifyName" | "websiteUrl" | "loginUrl";
type Errors = Partial<Record<Field, string>>;
type Load =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; supplier: Supplier | null };

const ORDER: Field[] = ["name", "shopifyName", "websiteUrl", "loginUrl"];
// The server says which field a problem belongs to. Anything else is shown above the buttons.
const FIELD_OF_CODE: Record<string, Field> = {
  invalid_name: "name",
  name_taken: "name",
  invalid_shopify_name: "shopifyName",
  shopify_name_taken: "shopifyName",
  invalid_website: "websiteUrl",
  invalid_login_url: "loginUrl",
};

const message = (e: unknown) =>
  e instanceof Error ? e.message : "Something went wrong. Please try again.";

export function SupplierFormPage({ api, id }: { api: Api; id?: string }) {
  const editing = id !== undefined;
  useTitle(editing ? "Edit supplier" : "Add supplier");
  const supplierQuery = useGetSupplierQuery(id ?? "", { enabled: editing });
  const load: Load = !editing
    ? { kind: "ready", supplier: null }
    : supplierQuery.data
      ? { kind: "ready", supplier: supplierQuery.data }
      : supplierQuery.isError
        ? { kind: "error", message: message(supplierQuery.error) }
        : { kind: "loading" };

  /** A card changed the supplier: read it again without the loading screen, so the page keeps what the owner typed. */
  const refreshSupplier = useSupplierRefresh();
  const reload = () => {
    if (id !== undefined) refreshSupplier(id);
  };

  const ready = load.kind === "ready" ? load : null;
  return (
    <>
      <PageHeader
        back={{ to: "/suppliers", label: "Back to suppliers" }}
        title={ready?.supplier ? ready.supplier.name : editing ? "Edit supplier" : "Add supplier"}
        description={editing ? undefined : "Add a supplier website you want to check for stock."}
        actions={
          ready?.supplier && (
            <>
              <Button variant="outline" asChild>
                <Link to={`/suppliers/${ready.supplier.id}/rules`}>Stock rules</Link>
              </Button>
              {ready.supplier.needsLogin && (
                <Button variant="outline" asChild>
                  <Link to={`/suppliers/${ready.supplier.id}/connect`}>Log in</Link>
                </Button>
              )}
            </>
          )
        }
      >
        {ready?.supplier && <Facts supplier={ready.supplier} />}
      </PageHeader>

      {load.kind === "loading" && (
        <div className="flex max-w-3xl flex-col gap-4">
          <p role="status" className="sr-only">
            Loading…
          </p>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-2/3" />
        </div>
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
      {load.kind === "ready" && !load.supplier && (
        <div className="flex max-w-3xl flex-col">
          <section className="scroll-mt-16 border-t border-border py-7 first:border-t-0 first:pt-2 [&_h2]:text-base [&_h2]:font-semibold lg:[&_h2]:text-[0.9375rem] [&_legend]:text-base [&_legend]:font-semibold lg:[&_legend]:text-[0.9375rem]">
            <SupplierForm supplier={null} />
          </section>
        </div>
      )}
      {load.kind === "ready" && load.supplier && (
        <div className="grid gap-8 lg:grid-cols-[11rem_minmax(0,1fr)]">
          <PartsIndex supplier={load.supplier} />
          <div className="flex min-w-0 max-w-3xl flex-col">
            <section
              id="part-details"
              className="scroll-mt-16 border-t border-border py-7 first:border-t-0 first:pt-2 [&_h2]:text-base [&_h2]:font-semibold lg:[&_h2]:text-[0.9375rem] [&_legend]:text-base [&_legend]:font-semibold lg:[&_legend]:text-[0.9375rem]"
            >
              <h2 className="mb-4">Details</h2>
              <SupplierForm supplier={load.supplier} />
            </section>
            <section
              id="part-permission"
              className="scroll-mt-16 border-t border-border py-7 first:border-t-0 first:pt-2 [&_h2]:text-base [&_h2]:font-semibold lg:[&_h2]:text-[0.9375rem] [&_legend]:text-base [&_legend]:font-semibold lg:[&_legend]:text-[0.9375rem]"
            >
              <PermissionPanel api={api} supplier={load.supplier} onSaved={reload} />
            </section>
            <section
              id="part-region"
              className="scroll-mt-16 border-t border-border py-7 first:border-t-0 first:pt-2 [&_h2]:text-base [&_h2]:font-semibold lg:[&_h2]:text-[0.9375rem] [&_legend]:text-base [&_legend]:font-semibold lg:[&_legend]:text-[0.9375rem]"
            >
              <RegionPanel api={api} supplier={load.supplier} />
            </section>
            <section
              id="part-checks"
              className="scroll-mt-16 border-t border-border py-7 first:border-t-0 first:pt-2 [&_h2]:text-base [&_h2]:font-semibold lg:[&_h2]:text-[0.9375rem] [&_legend]:text-base [&_legend]:font-semibold lg:[&_legend]:text-[0.9375rem]"
            >
              <SchedulePanel api={api} supplier={load.supplier} />
            </section>
            <section
              id="part-login"
              className="scroll-mt-16 border-t border-border py-7 first:border-t-0 first:pt-2 [&_h2]:text-base [&_h2]:font-semibold lg:[&_h2]:text-[0.9375rem] [&_legend]:text-base [&_legend]:font-semibold lg:[&_legend]:text-[0.9375rem]"
            >
              <NeedsLoginCard api={api} supplier={load.supplier} onChange={reload} />
            </section>
            {load.supplier.needsLogin && (
              <section
                id="part-auto-login"
                className="scroll-mt-16 border-t border-border py-7 first:border-t-0 first:pt-2 [&_h2]:text-base [&_h2]:font-semibold lg:[&_h2]:text-[0.9375rem] [&_legend]:text-base [&_legend]:font-semibold lg:[&_legend]:text-[0.9375rem]"
              >
                <AutoLoginCard api={api} supplier={load.supplier} onChange={reload} />
              </section>
            )}
          </div>
        </div>
      )}
    </>
  );
}

const PERMISSION_WORDS: Record<Supplier["automationPermission"], string> = {
  granted: "Allowed",
  not_granted: "Not allowed",
  unknown: "Not recorded",
};

/** One line under the name: its status, its website, and when its login was last checked. */
function Facts({ supplier: s }: { supplier: Supplier }) {
  const status = statusOf(s);
  return (
    <ul
      aria-label="About this supplier"
      className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground lg:text-[0.8125rem]"
    >
      <li>
        <Badge variant={status.tone}>{status.words}</Badge>
      </li>
      <li>{host(s.websiteUrl)}</li>
      {s.needsLogin && (
        <li>
          {s.lastSessionCheckAt ? (
            <>
              Login checked <When at={s.lastSessionCheckAt} />
            </>
          ) : (
            "Login never checked"
          )}
        </li>
      )}
    </ul>
  );
}

/** The parts of the page, each with where it stands, so the owner can jump to one. Beside the parts on a wide screen. */
function PartsIndex({ supplier: s }: { supplier: Supplier }) {
  const parts: [string, string, string?][] = [
    ["part-details", "Details"],
    ["part-permission", "Permission", PERMISSION_WORDS[s.automationPermission]],
    ["part-region", "Region", s.defaultRegion ?? "None"],
    ["part-checks", "Automatic checks", s.scheduleIntervalMinutes === null ? "Off" : "On"],
    ["part-login", "Login", s.needsLogin ? "Needed" : "Not needed"],
    ...(s.needsLogin
      ? ([["part-auto-login", "Automatic login", s.autoLogin ? "On" : "Off"]] as [
          string,
          string,
          string,
        ][])
      : []),
  ];
  return (
    <nav aria-label="Parts of this supplier" className="max-lg:hidden">
      <ul className="sticky top-16 flex flex-col text-[0.8125rem]">
        {parts.map(([id, label, state]) => (
          <li key={id}>
            <a
              href={`#${id}`}
              className="flex justify-between gap-2 border-l-2 border-border py-1.5 pl-3 text-muted-foreground hover:border-foreground hover:text-foreground"
            >
              <span>{label}</span>
              {state && (
                <span className={state === "Allowed" || state === "On" ? "text-good" : undefined}>
                  {state}
                </span>
              )}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function SupplierForm({ supplier }: { supplier: Supplier | null }) {
  const [name, setName] = useState(supplier?.name ?? "");
  const [shopifyName, setShopifyName] = useState(supplier?.shopifyName ?? "");
  const [websiteUrl, setWebsiteUrl] = useState(supplier?.websiteUrl ?? "");
  const [loginUrl, setLoginUrl] = useState(supplier?.loginUrl ?? "");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const createSupplier = useCreateSupplierMutation();
  const updateSupplier = useUpdateSupplierMutation();
  const refs: Record<Field, React.RefObject<HTMLInputElement | null>> = {
    name: useRef<HTMLInputElement>(null),
    shopifyName: useRef<HTMLInputElement>(null),
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
    if (!websiteUrl.trim())
      next.websiteUrl = "Enter the supplier's website address, starting with https://.";
    if (Object.keys(next).length > 0) {
      showErrors(next);
      return null;
    }
    const values: SupplierInput = {
      name: name.trim(),
      websiteUrl: websiteUrl.trim(),
      loginUrl: loginUrl.trim() || null,
    };
    // Sent when filled in, and when editing (so clearing it reaches the server). Empty means "the same as the name".
    if (shopifyName.trim() || supplier) values.shopifyName = shopifyName.trim() || null;
    return values;
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
          (
            Object.entries(values) as [keyof SupplierInput, SupplierInput[keyof SupplierInput]][]
          ).filter(([k, v]) => (supplier[k] ?? null) !== v),
        )
      : values;
    if (supplier && Object.keys(patch).length === 0) return navigate("/suppliers");

    setSaving(true);
    try {
      await (supplier ? updateSupplier.mutateAsync({ id: supplier.id, patch }) : createSupplier.mutateAsync(values));
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
      <FormField
        id={key}
        label={label}
        hint={<span id={`${key}-hint`}>{opts.hint}</span>}
        error={error}
      >
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
      {field("name", "Name", name, setName, {
        hint: "How you want to see this supplier in the app.",
      })}
      {field("shopifyName", "Name in Shopify (optional)", shopifyName, setShopifyName, {
        hint: "The supplier name your Shopify products use (the custom.supplier_name field). Leave it empty if it is the same as the name above.",
      })}
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
