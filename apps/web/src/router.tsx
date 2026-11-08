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
  if (window.location.pathname === to) return;
  window.history.pushState(null, "", to);
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
