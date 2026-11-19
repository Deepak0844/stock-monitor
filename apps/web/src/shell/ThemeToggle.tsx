import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { systemDark, useTheme } from "@/lib/theme.js";

/** One press switches between light and dark. Settings › Appearance also offers "Follow my device". */
export function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  const dark = theme === "dark" || (theme === "system" && systemDark());
  return (
    <Button
      variant="ghost"
      size="icon"
      className="text-muted-foreground hover:text-foreground"
      aria-label="Dark theme"
      aria-pressed={dark}
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      {dark ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </Button>
  );
}
