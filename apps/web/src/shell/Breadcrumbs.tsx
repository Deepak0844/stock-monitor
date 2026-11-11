import { createContext, useContext, useEffect } from "react";
import { ChevronRight } from "lucide-react";
import { Link } from "../router.js";

export type Crumb = { label: string; to?: string };

const HOME: Crumb = { label: "Dashboard", to: "/" };
const SUPPLIERS: Crumb = { label: "Suppliers", to: "/suppliers" };
const LINKS: Crumb = { label: "Links", to: "/mappings" };

/** The trail for a page, from its address. A page that knows more, such as a supplier's name, can replace it with `useCrumbs`. */
export function crumbsForPath(path: string): Crumb[] {
  if (path === "/") return [{ label: "Dashboard" }];
  if (path === "/suppliers") return [HOME, { label: "Suppliers" }];
  if (path === "/suppliers/new") return [HOME, SUPPLIERS, { label: "Add supplier" }];
  const supplier = /^\/suppliers\/[^/]+\/(edit|rules|connect)$/.exec(path)?.[1];
  if (supplier) return [HOME, SUPPLIERS, { label: supplier === "edit" ? "Edit supplier" : supplier === "rules" ? "Stock rules" : "Connect" }];
  if (path === "/mappings") return [HOME, { label: "Links" }];
  if (path === "/mappings/new") return [HOME, LINKS, { label: "Add link" }];
  if (path === "/mappings/import") return [HOME, LINKS, { label: "Import links" }];
  if (/^\/mappings\/[^/]+\/edit$/.test(path)) return [HOME, LINKS, { label: "Edit link" }];
  if (path === "/products") return [HOME, { label: "Products" }];
  if (path === "/proposals") return [HOME, { label: "Proposals" }];
  if (path === "/settings" || path === "/settings/shopify") return [HOME, { label: "Settings", to: "/settings/shopify" }, { label: "Shopify" }];
  return [HOME, { label: "Page not found" }];
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
        {items.map((crumb, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${crumb.label}-${i}`} className="flex min-w-0 items-center gap-1">
              {i > 0 && <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />}
              {last || !crumb.to ? (
                <span aria-current={last ? "page" : undefined} className={last ? "truncate font-semibold text-foreground" : "truncate"}>
                  {crumb.label}
                </span>
              ) : (
                <Link to={crumb.to} className="truncate hover:text-foreground hover:underline">
                  {crumb.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Lets a page replace the trail the shell works out from the address. */
export const CrumbsContext = createContext<(items: Crumb[] | null) => void>(() => {});

export function useCrumbs(items: Crumb[]): void {
  const set = useContext(CrumbsContext);
  const key = JSON.stringify(items);
  useEffect(() => {
    set(JSON.parse(key) as Crumb[]);
    return () => set(null);
  }, [key, set]);
}
