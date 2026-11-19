import { forwardRef } from "react";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils.js";
import { Link } from "../router.js";
import { NAV, countLabel } from "./nav.js";

type Props = { path: string; proposalCount?: number; attentionCount?: number; onMore: () => void };

const TABS = ["Dashboard", "Links", "Proposals", "Suppliers"].map((label) => NAV.find((n) => n.label === label)!);
const tab = "relative flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 text-[0.6875rem] text-muted-foreground [&_svg]:size-5";

/** Five tabs along the bottom of a phone: the four main pages and More, which holds the rest. */
export const BottomTabs = forwardRef<HTMLButtonElement, Props>(function BottomTabs({ path, proposalCount, attentionCount, onMore }, moreRef) {
  const moreCurrent = path.startsWith("/products") || path.startsWith("/settings");
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 flex border-t border-foreground bg-sidebar pb-[env(safe-area-inset-bottom)]">
      {TABS.map((item) => {
        const isCurrent = item.current(path);
        const n = item.count === "proposals" ? proposalCount : item.count === "attention" ? attentionCount : 0;
        return (
          <Link
            key={item.label}
            to={item.to}
            aria-current={isCurrent ? "page" : undefined}
            aria-label={countLabel(item, n)}
            className={cn(tab, isCurrent && "font-semibold text-foreground shadow-[inset_0_2px_0_var(--foreground)]")}
          >
            {item.icon}
            {item.label}
            {n ? (
              <span aria-hidden="true" className="absolute top-1 left-1/2 ml-2 rounded-full bg-bad px-1.5 font-mono text-[0.625rem] leading-4 font-semibold text-destructive-foreground">
                {n}
              </span>
            ) : null}
          </Link>
        );
      })}
      <button ref={moreRef} type="button" onClick={onMore} className={cn(tab, moreCurrent && "font-semibold text-foreground shadow-[inset_0_2px_0_var(--foreground)]")}>
        <MoreHorizontal aria-hidden="true" />
        More
      </button>
    </nav>
  );
});
