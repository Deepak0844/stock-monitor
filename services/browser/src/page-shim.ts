/**
 * The container runs this service through tsx, which keeps function names by wrapping named inner functions of a page script in
 * `__name(...)`. That helper does not exist inside a web page, so the script would fail there with "ReferenceError: __name is not
 * defined" (and a reader that swallows errors would see an empty page). This gives the page one. Install it before any script that
 * has named inner functions is sent into a page: `page.addInitScript(NAME_SHIM)` for every page that loads afterwards (frames too),
 * or `page.evaluate(NAME_SHIM)` for the one that is already open.
 */
export const NAME_SHIM = "globalThis.__name = globalThis.__name || ((fn) => fn)";
