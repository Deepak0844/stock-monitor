import { useEffect, useRef, useState, type ReactNode } from "react";
import { Toaster } from "@/components/ui/toaster.js";
import { cn } from "@/lib/utils.js";
import { useWide } from "@/lib/useWide.js";
import { Logo } from "../components/Logo.js";
import { OfflineBar } from "../components/OfflineBar.js";
import { Link, usePath } from "../router.js";
import type { ScheduleRow } from "../api.js";
import { BottomTabs } from "./BottomTabs.js";
import { Breadcrumbs, CrumbsContext, crumbsForPath, type Crumb } from "./Breadcrumbs.js";
import { CheckStatus } from "./CheckStatus.js";
import { MoreSheet } from "./MoreSheet.js";
import { NAV, countLabel } from "./nav.js";
import { NotificationBell } from "./NotificationBell.js";
import { AccountMenu } from "./AccountMenu.js";
import type { NotificationsState } from "./useNotifications.js";

type Props = {
  email: string;
  onSignOut: () => void;
  children: ReactNode;
  notifications: NotificationsState;
  /** Suggestions waiting for the owner. Shown beside Proposals when above 0. */
  proposalCount?: number;
  /** Open notices (reconnect, review rules). Shown beside Dashboard when above 0. */
  attentionCount?: number;
  /** The schedule overview, for the check status at the foot of the sidebar. null while it loads. */
  schedule?: ScheduleRow[] | null;
};

/** The frame around every signed-in page: a sidebar on a wide screen, tabs along the bottom on a phone. */
export function AppShell({
  email,
  onSignOut,
  children,
  notifications,
  proposalCount,
  attentionCount,
  schedule = null,
}: Props) {
  const wide = useWide();
  const [moreOpen, setMoreOpen] = useState(false);
  const [crumbs, setCrumbs] = useState<Crumb[] | null>(null);
  const path = usePath();
  const mainRef = useRef<HTMLElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const firstRender = useRef(true);

  // After moving to another page, close More and put keyboard and screen reader focus on the new content.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    setMoreOpen(false);
    mainRef.current?.focus();
  }, [path]);

  const countOf = (item: (typeof NAV)[number]) =>
    item.count === "proposals" ? proposalCount : item.count === "attention" ? attentionCount : 0;

  return (
    <div className="min-h-screen bg-background text-foreground lg:grid lg:grid-cols-[14rem_minmax(0,1fr)]">
      <a
        href="#main"
        className="absolute top-2 left-2 z-[60] -translate-y-24 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground focus:translate-y-0"
      >
        Skip to main content
      </a>

      {wide && (
        <aside className="sticky top-0 flex h-screen flex-col border-r border-border bg-sidebar text-sidebar-foreground">
          <div className="px-4 py-5 text-foreground">
            <Logo />
          </div>
          <nav id="main-nav" aria-label="Main" className="flex-1 overflow-y-auto">
            <ul className="flex flex-col">
              {NAV.map((item) => {
                const isCurrent = item.current(path);
                const n = countOf(item);
                return (
                  <li key={item.label}>
                    <Link
                      to={item.to}
                      aria-current={isCurrent ? "page" : undefined}
                      aria-label={countLabel(item, n)}
                      className={cn(
                        "relative flex min-h-9 items-center gap-3 px-4 text-[0.8125rem] font-medium hover:bg-hover hover:text-foreground [&_svg]:size-4 [&_svg]:shrink-0",
                        isCurrent &&
                          "bg-sidebar-active font-semibold text-foreground shadow-[inset_2px_0_0_var(--foreground)]",
                      )}
                    >
                      {item.icon}
                      {item.label}
                      {n ? (
                        <span
                          data-count
                          aria-hidden="true"
                          className="ml-auto font-mono text-xs font-medium text-bad"
                        >
                          {n}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <CheckStatus rows={schedule} />
          <p
            className="truncate border-t border-border px-4 py-3 text-[0.8125rem] text-muted-foreground"
            title={email}
          >
            {email}
          </p>
        </aside>
      )}

      <Toaster />
      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-border bg-background px-4 py-2 sm:px-6">
          {!wide && <Logo className="text-foreground [&>span:last-child]:sr-only" />}
          <div className="min-w-0 flex-1">
            <Breadcrumbs items={crumbs ?? crumbsForPath(path)} />
          </div>
          <div className="flex items-center gap-1">
            <NotificationBell state={notifications} />
            <span aria-hidden="true" className="mx-1.5 h-5 w-px bg-border max-lg:hidden" />
            <AccountMenu email={email} onSignOut={onSignOut} compact={!wide} />
          </div>
        </header>
        <OfflineBar />
        <CrumbsContext.Provider value={setCrumbs}>
          <main
            id="main"
            tabIndex={-1}
            ref={mainRef}
            className={cn(
              "mx-auto w-full max-w-7xl px-4 py-6 outline-none sm:px-6",
              !wide && "pb-24",
            )}
          >
            {children}
          </main>
        </CrumbsContext.Provider>
      </div>

      {!wide && (
        <>
          <BottomTabs
            ref={moreButton}
            path={path}
            proposalCount={proposalCount}
            attentionCount={attentionCount}
            onMore={() => setMoreOpen(true)}
          />
          <MoreSheet
            open={moreOpen}
            onClose={() => setMoreOpen(false)}
            email={email}
            onSignOut={onSignOut}
            schedule={schedule}
            returnFocusTo={moreButton}
          />
        </>
      )}
    </div>
  );
}
