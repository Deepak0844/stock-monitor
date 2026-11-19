import { useRef, type RefObject } from "react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog.js";
import type { ScheduleRow } from "../api.js";
import { Link } from "../router.js";
import { CheckStatus } from "./CheckStatus.js";
import { NAV } from "./nav.js";
import { ThemeToggle } from "./ThemeToggle.js";

type Props = {
  open: boolean;
  onClose: () => void;
  email: string;
  onSignOut: () => void;
  schedule: ScheduleRow[] | null;
  /** Where focus goes back to when the sheet closes without following a link: the More tab. */
  returnFocusTo: RefObject<HTMLElement | null>;
};

const MORE = NAV.filter((n) => n.label === "Products" || n.label === "Settings");

/** What does not fit in the phone tabs: the check status, Products, Settings, the theme and the account. */
export function MoreSheet({ open, onClose, email, onSignOut, schedule, returnFocusTo }: Props) {
  // A followed link moves focus to the new page itself, so focus only goes back to More when the sheet was dismissed.
  const followedLink = useRef(false);
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        onOpenAutoFocus={() => (followedLink.current = false)}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!followedLink.current) returnFocusTo.current?.focus();
        }}
        className="top-auto bottom-0 left-0 w-full max-w-none translate-x-0 translate-y-0 rounded-none border-x-0 border-b-0 p-0 pb-[env(safe-area-inset-bottom)]"
      >
        <DialogTitle className="px-4 pt-4 pb-2 text-base font-semibold">More</DialogTitle>
        <CheckStatus rows={schedule} />
        <ul className="border-t border-border">
          {MORE.map((item) => (
            <li key={item.label}>
              <Link
                to={item.to}
                onClick={() => {
                  followedLink.current = true;
                  onClose();
                }}
                className="flex min-h-12 items-center gap-3 border-b border-border px-4 text-base [&_svg]:size-5"
              >
                {item.icon}
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <span className="text-sm text-muted-foreground">Theme</span>
          <ThemeToggle />
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-3">
          <span className="min-w-0 truncate text-sm text-muted-foreground">{email}</span>
          <Button variant="outline" onClick={onSignOut}>
            <LogOut aria-hidden="true" />
            Sign out
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
