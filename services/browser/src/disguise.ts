import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The disguise for a stealth supplier's live login window: a small extension that makes the window report a real
 * graphics card and the brand list of ordinary Google Chrome, instead of SwiftShader and Chromium only. It is loaded
 * with --load-extension, so the window still has no remote-control channel.
 */

export type Brand = { brand: string; version: string };

// Chromium's GREASE rule (components/embedder_support/user_agent_utils.cc), seeded by the major version. Checked
// against a real Google Chrome 157 and against Chrome for Testing 158's own two-brand list.
const GREASE_CHARS = [" ", "(", ":", "-", ".", "/", ")", ";", "=", "?", "_"];
const GREASE_VERSIONS = ["8", "99", "24"];
const ORDERS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];

/** The brands, with full versions, that real Google Chrome of this version reports, in its order. */
export function chromeBrands(full: string): Brand[] {
  const major = Number(full.split(".")[0]);
  const n = GREASE_CHARS.length;
  const grease = {
    brand: `Not${GREASE_CHARS[major % n]}A${GREASE_CHARS[(major + 1) % n]}Brand`,
    version: `${GREASE_VERSIONS[major % 3]}.0.0.0`,
  };
  const list = [grease, { brand: "Chromium", version: full }, { brand: "Google Chrome", version: full }];
  const out: Brand[] = [];
  ORDERS[major % 6].forEach((to, from) => (out[to] = list[from]));
  return out;
}

const major = (version: string) => version.split(".")[0];

/** The Sec-CH-UA header real Google Chrome of this version sends. */
export const secChUa = (full: string) => chromeBrands(full).map((b) => `"${b.brand}";v="${major(b.version)}"`).join(", ");

/** The version from a browser's `--version` line, or null. */
export function parseChromeVersion(out: string): string | null {
  return /\b(\d+\.\d+\.\d+\.\d+)\b/.exec(out)?.[1] ?? null;
}

const versions = new Map<string, Promise<string | null>>();

/** The browser's full version, asked once per executable. null when it cannot be read. */
export function chromeVersion(executable: string): Promise<string | null> {
  let version = versions.get(executable);
  if (!version) {
    version = new Promise((resolve) =>
      execFile(executable, ["--version"], { timeout: 10_000 }, (error, stdout) => resolve(error ? null : parseChromeVersion(String(stdout)))),
    );
    versions.set(executable, version);
  }
  return version;
}

// Every kind of request a page makes, so no request leaves with the real header.
const RESOURCE_TYPES = ["main_frame", "sub_frame", "stylesheet", "script", "image", "font", "object", "xmlhttprequest", "ping", "media", "websocket", "webtransport", "other"];

/** Writes the extension into `dir`: its manifest, the header rule, and the page script with this version's brands. */
export async function writeDisguise(dir: string, full: string): Promise<void> {
  const manifest = {
    manifest_version: 3,
    name: "Display",
    version: "1.0",
    permissions: ["declarativeNetRequest"],
    host_permissions: ["<all_urls>"],
    declarative_net_request: { rule_resources: [{ id: "ch", enabled: true, path: "rules.json" }] },
    content_scripts: [
      // In the page's own world, before its scripts, in every frame (also about:blank and srcdoc frames, which captchas use).
      { matches: ["<all_urls>"], js: ["page.js"], run_at: "document_start", all_frames: true, match_origin_as_fallback: true, world: "MAIN" },
    ],
  };
  const rules = [
    {
      id: 1,
      priority: 1,
      action: { type: "modifyHeaders", requestHeaders: [{ header: "sec-ch-ua", operation: "set", value: secChUa(full) }] },
      condition: { resourceTypes: RESOURCE_TYPES },
    },
  ];
  // A plain file, never a serialised TS function: tsx wraps those in a __name helper the page does not have.
  const page = await readFile(new URL("./disguise-page.js", import.meta.url), "utf8");
  await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest));
  await writeFile(join(dir, "rules.json"), JSON.stringify(rules));
  await writeFile(join(dir, "page.js"), `const FULL = ${JSON.stringify(chromeBrands(full))};\n${page}`);
}
