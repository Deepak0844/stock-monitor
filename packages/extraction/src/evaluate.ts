import { readNumber } from "./numbers.js";
import type { ButtonRule, PageDescription, TextRule } from "./types.js";
import { normaliseWords } from "./validate.js";

const MAX_LINE = 200;
const clip = (line: string) => line.trim().slice(0, MAX_LINE);

/**
 * The sections a rule may look at. With no heading, all of them. With a heading, the first section whose heading
 * contains those words, and the sub-sections below it, up to the next heading of the same or higher level.
 * A heading that is not on the page leaves nothing to look at.
 */
function scope(page: PageDescription, under?: string): PageDescription["sections"] {
  if (under === undefined) return page.sections;
  const wanted = normaliseWords(under);
  const start = page.sections.findIndex((s) => s.heading !== null && normaliseWords(s.heading).includes(wanted));
  if (start === -1) return [];
  const level = (page.sections[start] as PageDescription["sections"][number]).level;
  const out = [page.sections[start] as PageDescription["sections"][number]];
  for (const next of page.sections.slice(start + 1)) {
    if (next.heading === null || next.level <= level) break;
    out.push(next);
  }
  return out;
}
// A heading is text on the page too, so it counts as the first line of its own section.
const scopeLines = (page: PageDescription, under?: string) => scope(page, under).flatMap((s) => (s.heading === null ? s.lines : [s.heading, ...s.lines]));

/** The line that contains the rule's words, or null. */
export function textMatches(page: PageDescription, rule: TextRule): string | null {
  const wanted = normaliseWords(rule.text);
  const hit = scopeLines(page, rule.under).find((line) => normaliseWords(line).includes(wanted));
  return hit === undefined ? null : clip(hit);
}

/** The label of a button that matches the rule's label (and enabled setting, and heading), or null. */
export function buttonMatches(page: PageDescription, rule: ButtonRule): string | null {
  const wanted = normaliseWords(rule.label);
  const headings = rule.under === undefined ? null : new Set(scope(page, rule.under).map((s) => normaliseWords(s.heading ?? "")));
  const hit = page.buttons.find(
    (b) =>
      normaliseWords(b.label).includes(wanted) &&
      (rule.enabled === undefined || b.enabled === rule.enabled) &&
      (headings === null || (b.section !== null && headings.has(normaliseWords(b.section)))),
  );
  return hit === undefined ? null : clip(hit.label);
}

// After a label on one line: optional punctuation, then the number first ("Cardiff 0", "Glasgow: 1,204", "Stock: Only 3 left").
const NUMBER_FIRST = /^[\s:=\-–—]*(?:only\s+)?(\d[\d,]*)\+?(?!\d)/;
const ONLY_A_NUMBER = /^\s*\d[\d,]*\+?\s*$/;

export type LabelledNumber = { found: false } | { found: true; quantity: number | null; line: string };

/**
 * Finds a label and reads the number right after it: in the same table row, on the same line, or alone on the next line.
 * The first match under the heading wins. A label that only starts a longer one ("Bristol" in "Bristol North") is not a match.
 */
export function labelledNumber(page: PageDescription, label: string, under?: string): LabelledNumber {
  const wanted = normaliseWords(label);
  const lines = scopeLines(page, under);
  for (const [i, line] of lines.entries()) {
    const cells = line.split("\t");
    if (cells.length > 1) {
      if (normaliseWords(cells[0] as string) === wanted) return { found: true, quantity: readNumber(cells.slice(1).join(" ")), line: clip(line) };
      continue;
    }
    const words = normaliseWords(line);
    if (words === wanted) {
      const next = lines[i + 1];
      return { found: true, quantity: next !== undefined && ONLY_A_NUMBER.test(next) ? readNumber(next) : null, line: clip(line) };
    }
    if (words.startsWith(wanted)) {
      const number = NUMBER_FIRST.exec(words.slice(wanted.length));
      if (number) return { found: true, quantity: readNumber(number[1] as string), line: clip(line) };
    }
  }
  return { found: false };
}

/**
 * Is the region table still on the page: the heading is there, and under it at least one row that is a label and a number.
 * Without it, a missing region label cannot be told from a page that has changed.
 */
export function regionTable(page: PageDescription, under: string): boolean {
  const lines = scopeLines(page, under);
  return lines.some((line, i) => {
    const cells = line.split("\t");
    if (cells.length > 1) return cells[0]?.trim() !== "" && readNumber(cells.slice(1).join(" ")) !== null;
    if (ONLY_A_NUMBER.test(line)) return false;
    return /[^\d\s][\s:]\s*\d[\d,]*\+?$/.test(line.trim()) || (lines[i + 1] !== undefined && ONLY_A_NUMBER.test(lines[i + 1] as string));
  });
}
