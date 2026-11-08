import { useEffect, useState, type ReactNode } from "react";
import { Logo } from "../components/Logo.js";
import {
  IconApprovals,
  IconDashboard,
  IconHistory,
  IconLogout,
  IconMenu,
  IconProducts,
  IconSettings,
  IconSuppliers,
} from "../components/icons.js";

type Props = { email: string; onSignOut: () => void; children: ReactNode };

// Pages that do not exist yet are shown as "Soon", never as links that go nowhere.
const COMING = [
  { label: "Suppliers", icon: <IconSuppliers /> },
  { label: "Products", icon: <IconProducts /> },
  { label: "Approvals", icon: <IconApprovals /> },
  { label: "History", icon: <IconHistory /> },
  { label: "Settings", icon: <IconSettings /> },
];

export function AppShell({ email, onSignOut, children }: Props) {
  const [open, setOpen] = useState(false);

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
            <li>
              <a href="/" className="nav-item is-current" aria-current="page">
                <IconDashboard />
                Dashboard
              </a>
            </li>
            {COMING.map((item) => (
              <li key={item.label}>
                <span className="nav-item is-disabled" aria-disabled="true">
                  {item.icon}
                  <span>{item.label}</span>
                  <span className="badge">Soon</span>
                </span>
              </li>
            ))}
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
        <main id="main" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
