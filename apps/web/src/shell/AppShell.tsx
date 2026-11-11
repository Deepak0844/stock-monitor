import { useEffect, useRef, useState, type ReactNode } from "react";
import { CircleUser, LogOut, Menu } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu.js";
import { cn } from "@/lib/utils.js";
import { Logo } from "../components/Logo.js";
import { Link, usePath } from "../router.js";
import { IconApprovals, IconDashboard, IconLinks, IconProducts, IconSettings, IconSuppliers } from "../components/icons.js";
import { Breadcrumbs, CrumbsContext, crumbsForPath, type Crumb } from "./Breadcrumbs.js";
import { NotificationBell } from "./NotificationBell.js";
import { ThemeToggle } from "./ThemeToggle.js";
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
};

type NavItem = { label: string; icon: ReactNode; to: string; current: (path: string) => boolean; count?: "proposals" | "attention" };

const NAV: NavItem[] = [
  { label: "Dashboard", icon: <IconDashboard />, to: "/", current: (p) => p === "/", count: "attention" },
  { label: "Suppliers", icon: <IconSuppliers />, to: "/suppliers", current: (p) => p.startsWith("/suppliers") },
  { label: "Links", icon: <IconLinks />, to: "/mappings", current: (p) => p.startsWith("/mappings") },
  { label: "Products", icon: <IconProducts />, to: "/products", current: (p) => p.startsWith("/products") },
  { label: "Proposals", icon: <IconApprovals />, to: "/proposals", current: (p) => p.startsWith("/proposals"), count: "proposals" },
  { label: "Settings", icon: <IconSettings />, to: "/settings/shopify", current: (p) => p.startsWith("/settings") },
];

export function AppShell({ email, onSignOut, children, notifications, proposalCount, attentionCount }: Props) {
  const [open, setOpen] = useState(false);
  const [crumbs, setCrumbs] = useState<Crumb[] | null>(null);
  const path = usePath();
  const mainRef = useRef<HTMLElement>(null);
  const firstRender = useRef(true);

  // After moving to another page, close the phone menu and put keyboard and screen reader focus on the new content.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    setOpen(false);
    mainRef.current?.focus();
  }, [path]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="min-h-screen bg-background text-foreground lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
      <a
        href="#main"
        className="absolute left-2 top-2 z-[60] -translate-y-24 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground focus:translate-y-0"
      >
        Skip to main content
      </a>

      {open && <div aria-hidden="true" className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setOpen(false)} />}

      <aside
        data-open={open}
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-sidebar text-sidebar-foreground transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full max-lg:invisible",
        )}
      >
        <div className="px-5 py-5 text-white">
          <Logo />
        </div>
        <nav id="main-nav" aria-label="Main" className="flex-1 overflow-y-auto px-3">
          <ul className="flex flex-col gap-1">
            {NAV.map((item) => {
              const isCurrent = item.current(path);
              const n = item.count === "proposals" ? proposalCount : item.count === "attention" ? attentionCount : 0;
              return (
                <li key={item.label}>
                  <Link
                    to={item.to}
                    aria-current={isCurrent ? "page" : undefined}
                    aria-label={n ? `${item.label}, ${n} ${item.count === "proposals" ? "waiting" : n === 1 ? "needs attention" : "need attention"}` : undefined}
                    className={cn(
                      "relative flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium hover:bg-sidebar-active hover:text-white [&_svg]:size-[1.15rem] [&_svg]:shrink-0",
                      isCurrent && "bg-sidebar-active text-white before:absolute before:inset-y-2 before:left-0 before:w-1 before:rounded-full before:bg-accent",
                    )}
                  >
                    {item.icon}
                    {item.label}
                    {n ? (
                      <span data-count aria-hidden="true" className="ml-auto grid min-w-5 place-items-center rounded-full bg-accent px-1.5 text-xs font-bold leading-5 text-accent-foreground">
                        {n}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-card px-4 py-2.5 sm:px-6">
          <Button variant="outline" className="lg:hidden" aria-expanded={open} aria-controls="main-nav" onClick={() => setOpen((o) => !o)}>
            <Menu aria-hidden="true" />
            Menu
          </Button>
          <div className="min-w-0 flex-1">
            <Breadcrumbs items={crumbs ?? crumbsForPath(path)} />
          </div>
          <NotificationBell state={notifications} />
          <ThemeToggle />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="Account">
                <CircleUser aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>{email}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onSignOut}>
                <LogOut aria-hidden="true" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <CrumbsContext.Provider value={setCrumbs}>
          <main id="main" tabIndex={-1} ref={mainRef} className="mx-auto w-full max-w-7xl px-4 py-6 outline-none sm:px-6">
            {children}
          </main>
        </CrumbsContext.Provider>
      </div>
    </div>
  );
}
