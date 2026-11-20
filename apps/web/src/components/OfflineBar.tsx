import { useEffect, useState } from "react";

const RECHECK_MS = 15_000;

/** True when the server answers. Chrome on a Mac can say "offline" while the network works, so its word alone is not enough. */
async function serverAnswers(): Promise<boolean> {
  try {
    return (await fetch("/health", { cache: "no-store" })).ok;
  } catch {
    return false;
  }
}

/**
 * A bar across the top while the app cannot reach the server. It shows only when the browser says offline AND the
 * server does not answer, and it goes away by itself when the connection is back.
 */
export function OfflineBar() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const probe = async () => {
      clearTimeout(timer);
      const down = !(await serverAnswers());
      if (stopped) return;
      setOffline(down);
      if (down) timer = setTimeout(() => void probe(), RECHECK_MS);
    };
    const onOnline = () => {
      clearTimeout(timer);
      setOffline(false);
    };
    const onOffline = () => void probe();
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    if (typeof navigator !== "undefined" && !navigator.onLine) void probe();
    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);
  if (!offline) return null;
  return (
    <div role="status" className="flex items-center gap-2 border-b border-foreground bg-background px-4 py-2 text-sm sm:px-6">
      <span aria-hidden="true" className="size-[7px] shrink-0 rounded-full bg-bad" />
      You're offline. Pages show what was last loaded; changes wait until you're back.
    </div>
  );
}
