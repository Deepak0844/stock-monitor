const NOT_FOUND = [
  /\b(404|410)\b/,
  /not found/i,
  /(can'?t|cannot|could ?n'?o?t|couldn'?t) (be )?find/i,
  /(doesn'?t|does not) exist/i,
  /no longer (available|exists?)/i,
  /(product|page|item) (is )?(currently )?(unavailable|not available)/i,
];

/**
 * True when a page's title or main heading says the page is gone. Only those two short fields are read, never the
 * page body, so a review or a description that mentions "404" cannot make a normal product page look missing.
 */
export function looksLikeNotFound(page: { title: string | null; heading: string | null }): boolean {
  const text = `${page.title ?? ""}\n${page.heading ?? ""}`;
  return NOT_FOUND.some((pattern) => pattern.test(text));
}
