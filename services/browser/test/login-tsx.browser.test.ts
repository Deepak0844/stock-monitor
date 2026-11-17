// The container runs the service through tsx, which wraps named inner functions in __name(). That helper does not exist inside a
// web page, so a page script that needs it fails there; a reader that swallows errors then sees a page with no boxes, and the login
// says "form not found" on a page that plainly has them. vitest does not wrap, so only a run under tsx can catch it.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("runLogin under tsx", () => {
  it("finds the boxes, logs in with one request, and reports ok", () => {
    const probe = fileURLToPath(new URL("./login-probe.ts", import.meta.url));
    const out = execFileSync("node", ["--import", "tsx", probe], { encoding: "utf8", timeout: 90_000 });
    const seen = JSON.parse(out.trim().split("\n").pop() as string);
    expect(seen).toMatchObject({ result: "ok", why: [], posts: ["true/true"] });
    // Without the shim, a page script with a named inner function fails under tsx: that is why the login installs the shim. If this
    // is false, tsx has stopped wrapping names; check, then remove the shim (page-shim.ts) deliberately.
    expect(seen.bareFails, "tsx no longer wraps named functions in __name: the page shim may no longer be needed").toBe(true);
  }, 120_000);
});
