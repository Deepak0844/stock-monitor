import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import type { ShopifyConnection, VariantPage, VariantItem } from "../api.js";
import { useGetShopifyConnectionQuery, useGetShopifyVariantsQuery } from "../store/api/shopify/shopifyApi.js";
import { DataTable, type Column } from "../components/DataTable.js";
import { CopyButton } from "../components/CopyButton.js";
import { FilterChips } from "../components/FilterChips.js";
import { RowsSwitch } from "../components/RowsSwitch.js";
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
  {
    header: "Product",
    sortKey: "product",
    cell: (v) => <span className="font-semibold">{v.productTitle}</span>,
  },
  { header: "Variant", cell: (v) => variantName(v) },
  {
    header: "SKU",
    cell: (v) =>
      v.sku ? (
        <span className="inline-flex items-center gap-1">
          <span className="font-mono whitespace-nowrap">{v.sku}</span>
          <CopyButton value={v.sku} label="SKU" />
        </span>
      ) : (
        <span className="text-muted-foreground">No SKU</span>
      ),
  },
  {
    header: "Supplier",
    cell: (v) =>
      v.supplierName || v.supplierUrls.length > 0 ? (
        <>
          <span>{v.supplierName ?? <span className="text-muted-foreground">No name</span>}</span>
          {v.supplierUrls.length > 0 && (
            <ul className="flex flex-col gap-1">
              {v.supplierUrls.map((url, i) => (
                <li key={i} className="break-all text-muted-foreground">
                  {url}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <span className="text-muted-foreground">No supplier in Shopify</span>
      ),
  },
  {
    header: "Available",
    className: "font-mono",
    cell: (v) =>
      v.available === null ? (
        <span className="font-sans text-muted-foreground">Not stocked here</span>
      ) : (
        <span
          data-tone={v.available === 0 ? "bad" : undefined}
          className={v.available === 0 ? "font-semibold text-bad" : undefined}
        >
          {v.available}
        </span>
      ),
  },
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

export function ProductsPage() {
  useTitle("Products");
  const params = useListParams({ pageSize: 25 });
  const { page, pageSize, search, sort, dir, set } = params;
  const attention = params.filters.attention === "1";
  const filtering = search !== "" || attention;

  // A connection that cannot be read at first counts as none, so the page still says what to do. A later failed read keeps it.
  const connectionQuery = useGetShopifyConnectionQuery();
  const connection: ShopifyConnection | null | undefined =
    connectionQuery.data !== undefined ? connectionQuery.data : connectionQuery.isError ? null : undefined;
  const [q, setQ] = useState(search);
  // The previous page stays on screen, dimmed, while the next one loads, so the page does not jump.
  const variants = useGetShopifyVariantsQuery({
    page,
    pageSize,
    search: search || undefined,
    warningsOnly: attention,
    ...(sort ? { sort, dir } : {}),
  });
  const data: VariantPage | null = variants.data ?? null;
  const loading = variants.isPlaceholderData || (variants.isFetching && !variants.data);
  const error =
    variants.isError && !variants.isFetching && !variants.data
      ? variants.error instanceof Error
        ? variants.error.message
        : "Something went wrong. Please try again."
      : null;
  const load = () => void variants.refetch();

  // The search box waits for a pause in typing, then goes to the address. A change made elsewhere, such as clearing, comes back in.
  useEffect(() => {
    if (q === search) return;
    const timer = setTimeout(() => set({ search: q }), SEARCH_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [q, search, set]);
  useEffect(() => setQ(search), [search]);

  const nothingImported =
    data !== null && connection !== undefined && data.total === 0 && !filtering;
  // A page past the end is read again from the last page, so show it as loading.
  const rows = data === null || (data.items.length === 0 && data.total > 0) ? null : data.items;

  return (
    <>
      <PageHeader
        title="Products"
        description={
          connection?.locationName
            ? `Stock shown is available at ${connection.locationName}.`
            : "The variants imported from your Shopify store."
        }
      />

      {((data === null && error === null) || (connection === undefined && error === null)) && (
        <p role="status" className="sr-only">
          Loading…
        </p>
      )}

      {nothingImported ? (
        <div>
          <EmptyState
            title={
              connection
                ? "No products have been imported yet. Sync from Shopify in Settings."
                : "No products yet. Connect Shopify in Settings."
            }
            action={
              <Button asChild>
                <Link to="/settings/shopify">Go to Shopify settings</Link>
              </Button>
            }
          />
        </div>
      ) : (
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-4 border-b border-border pb-3">
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
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={attention}
                onChange={(e) => set({ attention: e.target.checked ? "1" : undefined })}
              />
              Show only items that need attention
            </label>
            <span className="ml-auto">
              <RowsSwitch />
            </span>
          </div>
          <FilterChips
            chips={[
              ...(search
                ? [
                    {
                      key: "search",
                      label: "Search",
                      value: `"${search}"`,
                      onRemove: () => set({ search: undefined }),
                    },
                  ]
                : []),
              ...(attention
                ? [
                    {
                      key: "attention",
                      label: "Show",
                      value: "Needs attention",
                      onRemove: () => set({ attention: undefined }),
                    },
                  ]
                : []),
            ]}
            onClearAll={() => set({ search: undefined, attention: undefined })}
          />
          <DataTable
            label="Products from Shopify"
            columns={columns}
            sort={sort ? { key: sort, dir } : null}
            onSort={(key) =>
              set({ sort: key, dir: sort === key && dir === "asc" ? "desc" : "asc" })
            }
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
          {data !== null && data.total > 0 && !error && (
            <Pager
              page={page}
              pageSize={pageSize}
              total={data.total}
              onPage={(n) => set({ page: n })}
              onPageSize={(n) => set({ pageSize: n })}
            />
          )}
        </div>
      )}
    </>
  );
}
