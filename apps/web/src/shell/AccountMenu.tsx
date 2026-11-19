import { ChevronDown, LogOut, Monitor, Moon, Settings, Sun, UserRound } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import { useTheme, type Theme } from "@/lib/theme.js";
import { navigate } from "../router.js";

/** Two letters for the round Account button: the start of the email, before the @. */
export const initialsOf = (email: string) =>
  (email.split("@")[0] ?? "")
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 2)
    .toUpperCase() || "?";

const THEMES: { value: Theme; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "Same as device", Icon: Monitor },
];

/** The owner's round initials in the top bar: who is signed in, the theme, the account pages and Sign out. */
export function AccountMenu({
  email,
  onSignOut,
  compact,
}: {
  email: string;
  onSignOut: () => void;
  compact?: boolean;
}) {
  const [theme, setTheme] = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account"
        className="inline-flex h-11 cursor-pointer items-center gap-1 rounded-md px-1.5 text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring lg:h-8"
      >
        <span
          aria-hidden="true"
          className="grid size-8 place-items-center rounded-full bg-foreground text-[0.6875rem] font-semibold text-background lg:size-7"
        >
          {initialsOf(email)}
        </span>
        {!compact && <ChevronDown aria-hidden="true" className="size-3.5" />}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64">
        <DropdownMenuLabel className="py-2.5">
          <span className="block text-sm font-semibold text-foreground">Signed in as</span>
          <span className="block truncate" title={email}>
            {email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="pb-1 font-semibold uppercase tracking-wider">
          Theme
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as Theme)}>
          {THEMES.map(({ value, label, Icon }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <Icon aria-hidden="true" />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate("/settings/account")}>
          <UserRound aria-hidden="true" />
          Account settings
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate("/settings/appearance")}>
          <Settings aria-hidden="true" />
          Appearance
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onSignOut}>
          <LogOut aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
