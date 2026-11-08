import { useEffect } from "react";

/** Sets the browser tab title, for example "Shopify settings · Stock Monitor". */
export function useTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} · Stock Monitor`;
  }, [title]);
}
