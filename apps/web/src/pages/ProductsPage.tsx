import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { Api, ShopifyConnection, VariantPage, VariantItem } from "../api.js";
import { IconAlert } from "../components/icons.js";
import { Notice } from "../components/Notice.js";
import { Link } from "../router.js";
import { useTitle } from "../useTitle.js";

const PAGE_SIZE = 25;

type Applied = { search: string; attention: boolean; page: number };

const COLUMNS = ["Product", "Variant", "SKU", "Available", "Notes"];

function variantName(v: VariantItem) {
  // Shopify names a product's only variant "Default Title". That means nothing to a shop owner.
  return v.variantTitle === "Default Title" ? "Only variant" : v.variantTitle;
}

export function ProductsPage({ api }: { api: Api }) {
  useTitle("Products");
  const [connection, setConnection] = useState<ShopifyConnection | null | undefined>(undefined);
  const [applied, setApplied] = useState<Applied>({ search: "", attention: false, page: 1 });
  const [searchText, setSearchText] = useState("");
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
      .variants({
        page: applied.page,
        pageSize: PAGE_SIZE,
        search: applied.search || undefined,
        warningsOnly: applied.attention,
      })
      .then((page) => {
        if (id !== latest.current) return; // a newer request has taken over
        setData(page);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (id !== latest.current) return;
        setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
        setLoading(false);
      });
  }, [api, applied]);

  useEffect(load, [load]);

  const search = (event: FormEvent) => {
    event.preventDefault();
    setApplied((a) => ({ ...a, search: searchText.trim(), page: 1 }));
  };
  const clearSearch = () => {
    setSearchText("");
    setApplied((a) => ({ ...a, search: "", page: 1 }));
  };

  const filtering = applied.search !== "" || applied.attention;
  const firstLoad = data === null && error === null;
  const ready = data !== null && error === null && connection !== undefined;
  const nothingImported = ready && data.total === 0 && !filtering;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <div className="page-header">
        <h1>Products</h1>
        <p className="muted">
          {connection?.locationName
            ? `Stock shown is available at ${connection.locationName}.`
            : "The variants imported from your Shopify store."}
        </p>
      </div>

      {(firstLoad || (data !== null && connection === undefined && error === null)) && (
        <p role="status" className="status">
          Loading…
        </p>
      )}

      {error !== null && (
        <>
          <Notice kind="error" role="alert">
            {error}
          </Notice>
          <div className="actions">
            <button type="button" className="button primary" onClick={load}>
              Try again
            </button>
          </div>
        </>
      )}

      {nothingImported && (
        <section className="panel empty-state">
          <p>
            {connection
              ? "No products have been imported yet. Sync from Shopify in Settings."
              : "No products yet. Connect Shopify in Settings."}
          </p>
          <Link to="/settings/shopify" className="button primary inline">
            Go to Shopify settings
          </Link>
        </section>
      )}

      {ready && !nothingImported && (
        <>
          <div className="toolbar">
            <form role="search" onSubmit={search} className="search">
              <label htmlFor="product-search">Search products</label>
              <div className="search-row">
                <input
                  id="product-search"
                  type="search"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="Product, variant or SKU"
                  autoComplete="off"
                />
                <button type="submit" className="button secondary">
                  Search
                </button>
              </div>
            </form>
            <label className="check">
              <input
                type="checkbox"
                checked={applied.attention}
                onChange={(e) => setApplied((a) => ({ ...a, attention: e.target.checked, page: 1 }))}
              />
              Show only items that need attention
            </label>
          </div>

          {data.total === 0 ? (
            <section className="panel empty-state">
              <p>{applied.search ? "No products match your search." : "No items need attention."}</p>
              {applied.search && (
                <button type="button" className="button secondary" onClick={clearSearch}>
                  Clear search
                </button>
              )}
            </section>
          ) : (
            <>
              <p className="count" role="status">
                Showing {(data.page - 1) * data.pageSize + 1} to {(data.page - 1) * data.pageSize + data.items.length} of{" "}
                {data.total} variants
              </p>
              {/* Explicit roles keep this a table for screen readers when the phone layout restyles it as cards. */}
              <table
                className={loading ? "data-table is-loading" : "data-table"}
                role="table"
                aria-label="Products from Shopify"
                aria-busy={loading}
              >
                <thead role="rowgroup">
                  <tr role="row">
                    {COLUMNS.map((c) => (
                      <th key={c} role="columnheader" scope="col">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody role="rowgroup">
                  {data.items.map((v) => (
                    <tr key={v.variantId} role="row">
                      <td role="cell" data-label="Product" className="strong">
                        {v.productTitle}
                      </td>
                      <td role="cell" data-label="Variant">
                        {variantName(v)}
                      </td>
                      <td role="cell" data-label="SKU">
                        {v.sku ?? <span className="muted">No SKU</span>}
                      </td>
                      <td role="cell" data-label="Available" className="number">
                        {v.available === null ? <span className="muted">Not stocked here</span> : v.available}
                      </td>
                      <td role="cell" data-label="Notes">
                        {v.warnings.length === 0 ? (
                          <>
                            <span className="muted" aria-hidden="true">
                              —
                            </span>
                            <span className="sr-only">None</span>
                          </>
                        ) : (
                          <ul className="note-list">
                            {v.warnings.map((w) => (
                              <li key={w.code}>
                                <IconAlert />
                                <span>{w.message}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {pages > 1 && (
                <nav className="pager" aria-label="Pages">
                  <button
                    type="button"
                    className="button secondary"
                    disabled={loading || data.page <= 1}
                    onClick={() => setApplied((a) => ({ ...a, page: a.page - 1 }))}
                  >
                    Previous page
                  </button>
                  <span>
                    Page {data.page} of {pages}
                  </span>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={loading || data.page >= pages}
                    onClick={() => setApplied((a) => ({ ...a, page: a.page + 1 }))}
                  >
                    Next page
                  </button>
                </nav>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
