import type { PageDescription } from "./types.js";

/** Builds a made-up page description for tests. Sections are [heading, level, lines]. */
export function page(sections: [string | null, number, string[]][], buttons: PageDescription["buttons"] = []): PageDescription {
  return {
    url: "https://shop.example/p/blue-tee",
    title: "Blue Tee",
    status: 200,
    pageClass: "ok",
    sections: sections.map(([heading, level, lines]) => ({ heading, level, lines })),
    buttons,
  };
}
export const btn = (label: string, enabled = true, section: string | null = null) => ({ label, enabled, section });
