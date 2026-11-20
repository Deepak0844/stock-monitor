import { cn } from "@/lib/utils.js";
import { usePreference } from "@/lib/preferences.js";
import { useTheme, type Theme } from "@/lib/theme.js";
import { Panel } from "../../components/Panel.js";
import { useTitle } from "../../useTitle.js";

/** A set of choices drawn as cards, each a real radio button with its own words. */
function Choices<T extends string>({ name, value, onChange, options }: { name: string; value: T; onChange(v: T): void; options: { value: T; label: string; hint?: string }[] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {options.map((o) => (
        <label
          key={o.value}
          className={cn("flex min-h-11 cursor-pointer items-start gap-2.5 rounded-md border border-input p-3 text-sm hover:border-foreground", o.value === value && "border-2 border-foreground p-[11px]")}
        >
          <input type="radio" name={name} value={o.value} aria-label={o.label} checked={o.value === value} onChange={() => onChange(o.value)} className="mt-0.5 size-4 cursor-pointer accent-foreground" />
          <span>
            <span className="block font-semibold">{o.label}</span>
            {o.hint && <span className="block text-xs text-muted-foreground">{o.hint}</span>}
          </span>
        </label>
      ))}
    </div>
  );
}

export function AppearancePage() {
  useTitle("Appearance settings");
  const [theme, setTheme] = useTheme();
  const [rows, setRows] = usePreference("rows");
  const [checkStatus, setCheckStatus] = usePreference("checkStatus");
  return (
    <>
      <Panel id="theme-heading" title="Theme" description="Light, dark, or whatever your computer or phone is set to.">
        <Choices<Theme>
          name="theme"
          value={theme}
          onChange={setTheme}
          options={[
            { value: "system", label: "Follow my device" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
      </Panel>
      <Panel id="rows-heading" title="Rows" description="How tightly tables are packed on a wide screen. On a phone, rows are always comfortable so they are easy to tap.">
        <Choices<"comfortable" | "compact">
          name="rows"
          value={rows}
          onChange={setRows}
          options={[
            { value: "comfortable", label: "Comfortable", hint: "Easier to read" },
            { value: "compact", label: "Compact", hint: "About twice as many rows on screen" },
          ]}
        />
      </Panel>
      <Panel id="status-heading" title="Sidebar check status" description="The box at the foot of the sidebar that says whether checks are running and when the next one is.">
        <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4 text-sm">
          <span>Show check status in the sidebar</span>
          <input type="checkbox" role="switch" checked={checkStatus} onChange={(e) => setCheckStatus(e.target.checked)} className="size-5 cursor-pointer accent-foreground" />
        </label>
      </Panel>
      <p className="mt-2 text-xs text-muted-foreground">These choices are saved on this device.</p>
    </>
  );
}
