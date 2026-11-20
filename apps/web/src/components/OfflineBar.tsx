import { useEffect, useState } from "react";

/** A bar across the top while the browser is offline. It goes away by itself when the connection is back. */
export function OfflineBar() {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  useEffect(() => {
    const update = (event: Event) => setOnline(event.type === "online");
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  if (online) return null;
  return (
    <div role="status" className="flex items-center gap-2 border-b border-foreground bg-background px-4 py-2 text-sm sm:px-6">
      <span aria-hidden="true" className="size-[7px] shrink-0 rounded-full bg-bad" />
      You're offline. Pages show what was last loaded; changes wait until you're back.
    </div>
  );
}
