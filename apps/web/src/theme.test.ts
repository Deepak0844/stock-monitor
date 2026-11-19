import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The colours live in theme.css. These checks keep every text and control pair readable in both themes.
const css = readFileSync(new URL("./theme.css", import.meta.url), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`No ${selector} block in theme.css`);
  const body = css.slice(start + selector.length + 2, css.indexOf("}", start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)) out[m[1] as string] = (m[2] as string).toLowerCase();
  return out;
}

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (r as number) + 0.7152 * (g as number) + 0.0722 * (b as number);
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

const TEXT: [string, string][] = [
  ["foreground", "background"],
  ["muted-foreground", "background"],
  ["muted-foreground", "sidebar"],
  ["sidebar-foreground", "sidebar"],
  ["good", "background"],
  ["bad", "background"],
  ["bad", "selected"],
  ["primary-foreground", "primary"],
];
const CONTROLS: [string, string][] = [
  ["input", "background"],
  ["ring", "background"],
];

const themes = { light: block(":root"), dark: block(":root.dark") };

describe.each(Object.entries(themes))("%s theme", (_name, t) => {
  it.each(TEXT)("%s on %s is at least 4.5:1", (fg, bg) => {
    expect(t[fg], fg).toBeDefined();
    expect(t[bg], bg).toBeDefined();
    expect(contrast(t[fg] as string, t[bg] as string)).toBeGreaterThanOrEqual(4.5);
  });
  it.each(CONTROLS)("%s on %s is at least 3:1", (fg, bg) => {
    expect(contrast(t[fg] as string, t[bg] as string)).toBeGreaterThanOrEqual(3);
  });
});

it("the dark theme for the system setting matches the dark theme chosen by hand", () => {
  expect(block(":root:not(.light)")).toEqual(themes.dark);
});
