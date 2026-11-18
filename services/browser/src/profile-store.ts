// SPIKE: where a supplier site's persistent browser profile lives, and who is using it. Chromium allows one browser per
// profile folder, so the login window and the checks take turns.
import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The default, memory-backed: kept while the container runs, gone when it restarts. PROFILE_DIR puts them on disk instead. */
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

/**
 * Removes the lock files a Chromium leaves in its profile. A kept profile on disk outlives the container, and a new container
 * has a new hostname, so Chromium would take the old lock for another machine's and refuse the profile. Only called by a
 * holder of the profile, so no browser of ours is using it.
 */
export async function clearStaleLocks(dir: string): Promise<void> {
  for (const name of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) await rm(join(dir, name), { force: true });
}
