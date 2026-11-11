import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from "react";

// A very small router built on the browser's own history. There is no library: the app has a
// handful of pages and every page is a plain address that also works when typed or bookmarked.
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

if (typeof window !== "undefined") window.addEventListener("popstate", notify);

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export function navigate(to: string): void {
  if (window.location.pathname + window.location.search === to) return;
  window.history.pushState(null, "", to);
  notify();
}

/** The query string of the current address, such as "?page=2". */
export function useSearch(): string {
  return useSyncExternalStore(subscribe, () => window.location.search, () => "");
}

/** Writes the query string without adding a history entry, so Back still leaves the page. */
export function replaceSearch(search: string): void {
  const next = `${window.location.pathname}${search}${window.location.hash}`;
  if (next === `${window.location.pathname}${window.location.search}${window.location.hash}`) return;
  window.history.replaceState(null, "", next);
  notify();
}

export function usePath(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname, () => "/");
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { to: string };

/** A real link. A plain click moves within the app. Ctrl, Cmd, Shift and middle clicks are left to the browser. */
export function Link({ to, onClick, ...rest }: LinkProps) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={handleClick} {...rest} />;
}
