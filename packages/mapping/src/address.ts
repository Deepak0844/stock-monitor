import { validateSupplierUrl } from "@stock-monitor/supplier-session";

export type CleanAddress = { ok: true; url: string } | { ok: false; message: string };

// Search-tracking parts Shopify's search adds to links. Nothing else is removed: ?variant= must stay.
const TRACKING = ["_pos", "_psq", "_psid", "_ss"];
const FIRST_ADDRESS = /https?:\/\/[^\s"'\\\]]+/i;

/** Takes a cell holding an address, a list of addresses or JSON with one in it, and returns the first, cleaned and checked. */
export function cleanAddress(cell: string): CleanAddress {
  const found = FIRST_ADDRESS.exec(cell.replace(/\\\//g, "/"));
  if (!found) return { ok: false, message: "No address in that row." };
  let url: URL;
  try {
    url = new URL(found[0]);
  } catch {
    return { ok: false, message: "That address is not a valid web address." };
  }
  for (const key of TRACKING) url.searchParams.delete(key);
  const checked = validateSupplierUrl(url.href);
  return checked.ok ? { ok: true, url: checked.url } : { ok: false, message: checked.message };
}

const bare = (host: string) => host.toLowerCase().replace(/^www\./, "");

/** True when the page is on the supplier's own website: the same host or a subdomain of it. */
export function sameSite(url: string, supplierHost: string): boolean {
  let host: string;
  try {
    host = bare(new URL(url).hostname);
  } catch {
    return false;
  }
  const site = bare(supplierHost);
  return host === site || host.endsWith(`.${site}`);
}
