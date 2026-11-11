import { useCallback, useMemo } from "react";
import { replaceSearch, useSearch } from "../router.js";

export const PAGE_SIZES = [10, 25, 50] as const;
const RESERVED = new Set(["page", "pageSize", "search"]);

export type ListParams = {
  page: number;
  pageSize: number;
  search: string;
  /** Every other query value, such as `status`. */
  filters: Record<string, string>;
  /** Changing the search, the size or a filter goes back to page 1. An empty or undefined value removes the key. */
  set(patch: { page?: number; pageSize?: number; search?: string } & Record<string, string | number | undefined>): void;
};

/** The state of a list, kept in the address so a page can be bookmarked and Back works. */
export function useListParams(defaults: { pageSize: number }): ListParams {
  const query = useSearch();
  const params = useMemo(() => new URLSearchParams(query), [query]);

  const rawPage = Number(params.get("page"));
  const page = Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1;
  const rawSize = Number(params.get("pageSize"));
  const pageSize = (PAGE_SIZES as readonly number[]).includes(rawSize) ? rawSize : defaults.pageSize;
  const search = params.get("search") ?? "";
  const filters = useMemo(() => {
    const out: Record<string, string> = {};
    params.forEach((value, key) => {
      if (!RESERVED.has(key) && value) out[key] = value;
    });
    return out;
  }, [params]);

  const set = useCallback<ListParams["set"]>(
    (patch) => {
      const next = new URLSearchParams(window.location.search);
      for (const [key, value] of Object.entries(patch)) {
        const empty = value === undefined || value === "" || (key === "page" && value === 1) || (key === "pageSize" && value === defaults.pageSize);
        if (empty) next.delete(key);
        else next.set(key, String(value));
      }
      if (!("page" in patch)) next.delete("page");
      const text = next.toString();
      replaceSearch(text ? `?${text}` : "");
    },
    [defaults.pageSize],
  );

  return { page, pageSize, search, filters, set };
}
