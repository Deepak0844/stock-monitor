# Kept Profiles On Disk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Kept browser profiles survive container restarts and recreates, so suppliers keep seeing the same browser.

**Architecture:** A named Docker volume `browser-profiles` is mounted at `/data/profiles`, and a new `PROFILE_DIR` setting
points the kept profiles at it. Before every launch on a kept profile, Chromium's leftover `Singleton*` lock files are
removed. A recreated container has a new hostname, and Chromium refuses a profile that another host's lock still names.

**Tech Stack:** TypeScript, Docker Compose, vitest.

**Spec:** project 0 in `docs/superpowers/specs/2026-11-18-robust-auto-login-roadmap.md`, as approved by the owner on
2026-11-18. The design is the short one in the conversation: a volume, `PROFILE_DIR`, the lock clean-up, the 32 MB
cache cap kept, and no forget-profile button.

## Global Constraints

- Never write a supplier's name or domain in repo files.
- With `PROFILE_DIR` unset, the default stays `/tmp/sm-profiles`, so tests and the old behaviour are unchanged.
- The browser container keeps `read_only: true`. The one volume is the only writable place added.
- Commits: conventional type, no Claude attribution lines.

## Review Focus

- A lock left by another hostname (a recreated container): the window still opens and loads the page. Covered by the
  Task 2 container test.
- `PROFILE_DIR` set to a relative path or to an empty value is refused at start, or treated as unset. Covered by the
  Task 1 config test.
- The volume's folder is owned by the browser's user, so the first launch can write. Covered by the Task 2 container
  test (`docker run -v`).
- The compose test that says "mounts no host folder or volume" now allows exactly one named volume at
  `/data/profiles`, and still no bind mount.

---

### Task 1: Clear stale locks, and the PROFILE_DIR setting

**Files:** `services/browser/src/profile-store.ts`, `profile-store.test.ts`, `plain-window.ts`, `profile-check.ts`,
`config.ts`, `config.test.ts`, `main.ts`

- [ ] Test: `clearStaleLocks(dir)` removes `SingletonLock`, `SingletonSocket` and `SingletonCookie`, including
  dangling symlinks, and leaves every other file. It does not throw when none exist.
- [ ] Test: `loadConfig` turns `PROFILE_DIR=/data/profiles` into `profileDir: "/data/profiles"`, treats unset or `""`
  as undefined, and refuses `profiles/x` with `PROFILE_DIR must be an absolute path.`
- [ ] Run both tests and see them fail. Implement `clearStaleLocks(dir: string): Promise<void>` in profile-store.ts.
  Call it in the plain window's persistent branch after it removes `DevToolsActivePort`, and in profile-check's
  `launch`. Pass `config.profileDir` from main.ts to `startBrowserService({ profileDir })`.
- [ ] Run the tests and see them pass, then commit.

### Task 2: The volume

**Files:** `services/browser/Dockerfile`, `docker-compose.yml`, `services/browser/test/compose.docker.test.ts`,
`services/browser/test/container.docker.test.ts`, `docs/deployment.md`

- [ ] Compose test: the browser service has exactly one volume, of type `volume`, named `browser-profiles`, at
  `/data/profiles`, and `PROFILE_DIR=/data/profiles`. It has no bind mount.
- [ ] Container test, kept profile on a volume:
  1. Create a test volume and start the container with it (plain, persistent, `PROFILE_DIR`).
  2. Open a window and finish it.
  3. Put a `SingletonLock` symlink to `other-host-1` in the profile.
  4. Remove the container and start a new one on the same volume.
  5. Open a window: the fake supplier sees a new `/login` request, and the profile's `seeded` file is still there.
- [ ] Implement: in the Dockerfile, `mkdir -p /data/profiles && chown pwuser:pwuser /data/profiles` before `USER`. In
  compose, add the volume, the mount and the env var. In the docs, add a paragraph on the volume and how to forget
  one supplier's profile by hand.
- [ ] Run `npm run check` and the two docker test files, then commit.
