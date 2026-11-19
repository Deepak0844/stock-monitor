import type { ReactNode } from "react";
import { IconApprovals, IconDashboard, IconLinks, IconProducts, IconSettings, IconSuppliers } from "../components/icons.js";

export type NavItem = { label: string; icon: ReactNode; to: string; current: (path: string) => boolean; count?: "proposals" | "attention" };

export const NAV: NavItem[] = [
  { label: "Dashboard", icon: <IconDashboard />, to: "/", current: (p) => p === "/", count: "attention" },
  { label: "Suppliers", icon: <IconSuppliers />, to: "/suppliers", current: (p) => p.startsWith("/suppliers") },
  { label: "Links", icon: <IconLinks />, to: "/mappings", current: (p) => p.startsWith("/mappings") },
  { label: "Products", icon: <IconProducts />, to: "/products", current: (p) => p.startsWith("/products") },
  { label: "Proposals", icon: <IconApprovals />, to: "/proposals", current: (p) => p.startsWith("/proposals"), count: "proposals" },
  { label: "Settings", icon: <IconSettings />, to: "/settings/shopify", current: (p) => p.startsWith("/settings") },
];

/** The words a screen reader hears for a menu item with a count, or undefined when there is nothing to count. */
export function countLabel(item: NavItem, n: number | undefined): string | undefined {
  if (!n) return undefined;
  return `${item.label}, ${n} ${item.count === "proposals" ? "waiting" : n === 1 ? "needs attention" : "need attention"}`;
}
