import { useEffect, useRef, useState, type ReactNode } from "react";
import { Logo } from "../components/Logo.js";
import { Link, usePath } from "../router.js";
import {
  IconApprovals,
  IconDashboard,
  IconHistory,
  IconLogout,
  IconMenu,
  IconProducts,
  IconSettings,
  IconSuppliers, IconLinks,
} from "../components/icons.js";

type Props = { email: string; onSignOut: () => void; children: ReactNode; /** Suggestions waiting for the owner. Shown beside Proposals when above 0. */ proposalCount?: number };

type NavItem = { label: string; icon: ReactNode; to?: string; current?: (path: string) => boolean; count?: "proposals" };

// Pages that do not exist yet have no address and show "Soon", never a link that goes nowhere.
const NAV: NavItem[] = [
  { label: "Dashboard", icon: <IconDashboard />, to: "/", current: (p) => p === "/" },
  { label: "Suppliers", icon: <IconSuppliers />, to: "/suppliers", current: (p) => p.startsWith("/suppliers") },
  { label: "Links", icon: <IconLinks />, to: "/mappings", current: (p) => p.startsWith("/mappings") },
  { label: "Products", icon: <IconProducts />, to: "/products", current: (p) => p.startsWith("/products") },
  { label: "Proposals", icon: <IconApprovals />, to: "/proposals", current: (p) => p.startsWith("/proposals"), count: "proposals" },
  { label: "History", icon: <IconHistory /> },
  { label: "Settings", icon: <IconSettings />, to: "/settings/shopify", current: (p) => p.startsWith("/settings") },
];

export function AppShell({ email, onSignOut, children, proposalCount }: Props) {
  const [open, setOpen] = useState(false);
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
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to main content
      </a>

      <div className={open ? "sidebar is-open" : "sidebar"}>
        <div className="sidebar-head">
          <Logo />
          <button
            type="button"
            className="button secondary menu-button"
            aria-expanded={open}
            aria-controls="main-nav"
            onClick={() => setOpen((o) => !o)}
          >
            <IconMenu />
            Menu
          </button>
        </div>
        <nav id="main-nav" aria-label="Main">
          <ul className="nav-list">
            {NAV.map((item) => {
              const isCurrent = item.current?.(path) ?? false;
              return (
                <li key={item.label}>
                  {item.to ? (
                    <Link
                      to={item.to}
                      className={isCurrent ? "nav-item is-current" : "nav-item"}
                      aria-current={isCurrent ? "page" : undefined}
                      aria-label={item.count === "proposals" && proposalCount ? `${item.label}, ${proposalCount} waiting` : undefined}
                    >
                      {item.icon}
                      {item.label}
                      {item.count === "proposals" && proposalCount ? <span className="badge" aria-hidden="true">{proposalCount}</span> : null}
                    </Link>
                  ) : (
                    <span className="nav-item is-disabled" aria-disabled="true">
                      {item.icon}
                      <span>{item.label}</span>
                      <span className="badge">Soon</span>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>
      </div>

      <div className="content">
        <header className="topbar">
          <div className="user">
            <span className="user-email">{email}</span>
            <button type="button" className="button secondary" onClick={onSignOut}>
              <IconLogout />
              Sign out
            </button>
          </div>
        </header>
        <main id="main" tabIndex={-1} ref={mainRef}>
          {children}
        </main>
      </div>
    </div>
  );
}
