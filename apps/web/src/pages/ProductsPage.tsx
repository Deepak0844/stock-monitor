import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button.js";
import { Card } from "@/components/ui/card.js";
import { Input } from "@/components/ui/input.js";
import type { Api, ShopifyConnection, VariantPage, VariantItem } from "../api.js";
import { DataTable, type Column } from "../components/DataTable.js";
import { EmptyState } from "../components/EmptyState.js";
import { IconAlert } from "../components/icons.js";
import { PageHeader } from "../components/PageHeader.js";
import { Pager } from "../components/Pager.js";
import { useListParams } from "../lib/useListParams.js";
import { Link } from "../router.js";
import { useTitle } from "../useTitle.js";

const SEARCH_PAUSE_MS = 300;

function variantName(v: VariantItem) {
  // Shopify names a product's only variant "Default Title". That means nothing to a shop owner.
  return v.variantTitle === "Default Title" ? "Only variant" : v.variantTitle;
}

const columns: Column<VariantItem>[] = [
  { header: "Product", cell: (v) => <span className="font-semibold">{v.productTitle}</span> },
  { header: "Variant", cell: (v) => variantName(v) },
  { header: "SKU", cell: (v) => v.sku ?? <span className="text-muted-foreground">No SKU</span> },
  {
    header: "Supplier",
    cell: (v) =>
      v.supplierName || v.supplierUrl ? (
        <>
          <span>{v.supplierName ?? <span className="text-muted-foreground">No name</span>}</span>
          {v.supplierUrl && <span className="block break-all text-muted-foreground">{v.supplierUrl}</span>}
        </>
      ) : (
        <span className="text-muted-foreground">No supplier in Shopify</span>
      ),
  },
  { header: "Available", className: "tabular-nums", cell: (v) => (v.available === null ? <span className="text-muted-foreground">Not stocked here</span> : v.available) },
  {
    header: "Notes",
    cell: (v) =>
      v.warnings.length === 0 ? (
        <>
          <span className="text-muted-foreground" aria-hidden="true">
            —
          </span>
          <span className="sr-only">None</span>
        </>
      ) : (
        <ul className="flex flex-col gap-1">
          {v.warnings.map((w) => (
            <li key={w.code} className="flex items-start gap-2 text-warning">
              <IconAlert />
              <span>{w.message}</span>
            </li>
          ))}
        </ul>
      ),
  },
];

export function ProductsPage({ api }: { api: Api }) {
  useTitle("Products");
  const params = useListParams({ pageSize: 25 });
  const { page, pageSize, search, set } = params;
  const attention = params.filters.attention === "1";
  const filtering = search !== "" || attention;

  const [connection, setConnection] = useState<ShopifyConnection | null | undefined>(undefined);
  const [q, setQ] = useState(search);
  // The previous page stays on screen, dimmed, while the next one loads, so the page does not jump.
  const [data, setData] = useState<VariantPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  useEffect(() => {
    api.shopify.getConnection().then(setConnection).catch(() => setConnection(null));
  }, [api]);

  const load = useCallback(() => {
    const id = ++latest.current;
    setLoading(true);
    setError(null);
    api.shopify
      .variants({ page, pageSize, search: search || undefined, warningsOnly: attention })
      .then((result) => {
        if (id !== latest.current) return; // a newer request has taken over
        setData(result);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (id !== latest.current) return;
        setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
        setLoading(false);
      });
  }, [api, page, pageSize, search, attention]);
  useEffect(load, [load]);

  // The search box waits for a pause in typing, then goes to the address. A change made elsewhere, such as clearing, comes back in.
  useEffect(() => {
    if (q === search) return;
    const timer = setTimeout(() => set({ search: q }), SEARCH_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [q, search, set]);
  useEffect(() => setQ(search), [search]);

  const nothingImported = data !== null && connection !== undefined && data.total === 0 && !filtering;
  // A page past the end is read again from the last page, so show it as loading.
  const rows = data === null || (data.items.length === 0 && data.total > 0) ? null : data.items;

  return (
    <>
      <PageHeader
        title="Products"
        description={connection?.locationName ? `Stock shown is available at ${connection.locationName}.` : "The variants imported from your Shopify store."}
      />

      {((data === null && error === null) || (connection === undefined && error === null)) && (
        <p role="status" className="sr-only">
          Loading…
        </p>
      )}

      {nothingImported ? (
        <Card>
          <EmptyState
            title={connection ? "No products have been imported yet. Sync from Shopify in Settings." : "No products yet. Connect Shopify in Settings."}
            action={
              <Button asChild>
                <Link to="/settings/shopify">Go to Shopify settings</Link>
              </Button>
            }
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-4 border-b border-border p-4">
            <Input
              id="product-search"
              type="search"
              aria-label="Search products"
              placeholder="Search by product, variant or SKU"
              autoComplete="off"
              className="min-w-48 flex-1"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" className="size-4 accent-primary" checked={attention} onChange={(e) => set({ attention: e.target.checked ? "1" : undefined })} />
              Show only items that need attention
            </label>
          </div>
          <DataTable
            label="Products from Shopify"
            columns={columns}
            rows={rows}
            rowKey={(v) => v.variantId}
            loading={loading}
            error={error}
            onRetry={load}
            pageSize={pageSize}
            empty={
              <EmptyState
                title={search ? "No products match your search." : "No items need attention."}
                action={
                  search ? (
                    <Button variant="outline" onClick={() => set({ search: undefined })}>
                      Clear search
                    </Button>
                  ) : undefined
                }
              />
            }
          />
          {data !== null && data.total > 0 && !error && <Pager page={page} pageSize={pageSize} total={data.total} onPage={(n) => set({ page: n })} onPageSize={(n) => set({ pageSize: n })} />}
        </Card>
      )}
    </>
  );
}
