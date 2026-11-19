import type { ReactNode } from "react";
import { cn } from "@/lib/utils.js";
import { PageHeader } from "../../components/PageHeader.js";
import { Link } from "../../router.js";

export type SettingsPart = "shopify" | "suggestions" | "appearance" | "account";

const PARTS: { key: SettingsPart; label: string; to: string }[] = [
  { key: "shopify", label: "Shopify", to: "/settings/shopify" },
  { key: "suggestions", label: "Stock suggestions", to: "/settings/suggestions" },
  { key: "appearance", label: "Appearance", to: "/settings/appearance" },
  { key: "account", label: "Account", to: "/settings/account" },
];

/** Settings, with a small menu of its parts on the left of a wide screen and across the top of a phone. */
export function SettingsLayout({ current, children }: { current: SettingsPart; children: ReactNode }) {
  return (
    <>
      <PageHeader title="Settings" description="Your Shopify store, how stock suggestions work, and how the app looks." />
      <div className="grid gap-6 lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-8">
        <nav aria-label="Settings" className="max-lg:-mx-4 max-lg:overflow-x-auto max-lg:border-b max-lg:border-border max-lg:px-4">
          <ul className="flex gap-1 lg:flex-col lg:gap-0 lg:border-r lg:border-border">
            {PARTS.map((p) => (
              <li key={p.key}>
                <Link
                  to={p.to}
                  aria-current={p.key === current ? "page" : undefined}
                  className={cn(
                    "flex min-h-11 items-center px-3 text-sm whitespace-nowrap text-ink-soft hover:bg-hover hover:text-foreground lg:min-h-9 lg:text-[0.8125rem]",
                    p.key === current && "font-semibold text-foreground max-lg:shadow-[inset_0_-2px_0_var(--foreground)] lg:shadow-[inset_2px_0_0_var(--foreground)]",
                  )}
                >
                  {p.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="flex min-w-0 max-w-3xl flex-col">{children}</div>
      </div>
    </>
  );
}
