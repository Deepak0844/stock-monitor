/**
 * The container runs this service through tsx, which keeps function names by wrapping named inner functions of a page script in
 * `__name(...)`. That helper does not exist inside a web page, so the script would fail there with "ReferenceError: __name is not
 * defined" (and a reader that swallows errors would see an empty page). This gives the page one. Install it before any script that
 * has named inner functions is sent into a page: `page.addInitScript(NAME_SHIM)` for every page that loads afterwards (frames too),
 * or `page.evaluate(NAME_SHIM)` for the one that is already open.
 */
export const NAME_SHIM = "globalThis.__name = globalThis.__name || ((fn) => fn)";

type Patchable = { evaluate?: unknown; evaluateAll?: unknown };
const patched = new WeakSet<object>();

/**
 * Makes `__name` available to every page function this page runs, in whatever world it runs. Stealth drives the page through
 * Patchright, which runs page scripts in an isolated world that the init script never reaches, so a function with named inner
 * functions failed there and the login saw an empty page. Each function handed to `evaluate` or `evaluateAll` (of the page, its
 * frames and its locators) is wrapped so it defines the helper itself. Same arguments, same result. Safe to call again.
 */
export function shimPage(page: import("playwright").Page): void {
  const shim = (fn: unknown) => (typeof fn === "function" ? new Function("...args", `const __name = (f) => f; return (${String(fn)})(...args);`) : fn);
  for (const proto of [Object.getPrototypeOf(page), Object.getPrototypeOf(page.mainFrame()), Object.getPrototypeOf(page.locator("body"))] as Patchable[]) {
    if (patched.has(proto)) continue;
    patched.add(proto);
    for (const name of ["evaluate", "evaluateAll"] as const) {
      const original = proto[name];
      if (typeof original !== "function") continue;
      proto[name] = function (this: unknown, fn: unknown, ...rest: unknown[]) {
        return original.call(this, shim(fn), ...rest);
      };
    }
  }
}
