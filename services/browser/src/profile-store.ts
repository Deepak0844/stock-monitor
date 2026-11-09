// SPIKE: where a supplier site's persistent browser profile lives, and who is using it. Chromium allows one browser per
// profile folder, so the login window and the checks take turns.
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Memory-backed in the container: kept while it runs, gone when it restarts. */
export const PROFILE_ROOT = join(tmpdir(), "sm-profiles");

/** One folder per site (the host). The name is a hash, so no address can pick or climb out of a folder. */
export function profileDirFor(baseDir: string, url: string): string {
  return join(baseDir, createHash("sha256").update(new URL(url).host).digest("hex").slice(0, 16));
}

/** A fingerprint of a set of cookies, used to tell whether a profile still holds the session that is stored. */
// Only the parts that make a session, in a fixed order, so a stored copy that was reshaped on its way through the database matches.
export const cookieHash = (cookies: { domain?: string; path?: string; name?: string; value?: string }[]): string =>
  createHash("sha256")
    .update(JSON.stringify(cookies.map((c) => `${c.domain}|${c.path}|${c.name}|${c.value}`).sort()))
    .digest("hex");

const held = new Set<string>();
export const isHeld = (dir: string) => held.has(dir);
/** true when the caller now has the profile, false when somebody else already does. */
export function holdProfile(dir: string): boolean {
  if (held.has(dir)) return false;
  held.add(dir);
  return true;
}
export const releaseProfile = (dir: string) => void held.delete(dir);
