import { useEffect } from "react";
import { setPageTitle } from "./tabTitle.js";

/** Sets the page's name in the browser tab, for example "Shopify settings · Stock Monitor". */
export function useTitle(title: string): void {
  useEffect(() => setPageTitle(title), [title]);
}
