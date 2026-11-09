import type { PageClass } from "@stock-monitor/supplier-session";

/** What the browser saw on a page: the words it was showing, grouped under headings, and its buttons. Never raw HTML. */
export type PageDescription = {
  /** The page's address without a query string or fragment. */
  url: string;
  title: string;
  status: number | null;
  pageClass: PageClass;
  /** The first section has `heading: null` and holds the text before any heading. A table row is one line, cells joined with a tab. */
  sections: { heading: string | null; level: number; lines: string[] }[];
  buttons: { label: string; enabled: boolean; section: string | null }[];
};

export type TextRule = { type: "text"; text: string; under?: string };
export type ButtonRule = { type: "button"; label: string; enabled?: boolean; under?: string };
export type StockRule = TextRule | ButtonRule;

/** The owner's rules for one supplier. Data only: words and lists, never patterns or code. */
export type Recipe = {
  /** All must pass, or the page is not the product page any more. */
  pageChecks: StockRule[];
  /** Any one matching counts. */
  inStock: StockRule[];
  outOfStock: StockRule[];
  /** A number next to this label. */
  quantity?: { label: string; under?: string };
  /** The part of the page (under this heading) that lists a number for each region. */
  region?: { under: string };
};

export type Answer = "in_stock" | "out_of_stock" | "cannot_tell";
export type Reason =
  | "page_changed"
  | "both_matched"
  | "neither_matched"
  | "quantity_text_disagree"
  | "not_listed"
  | "check_failed"
  | "page_missing"
  | "never_worked";

export type Decision = {
  answer: Answer;
  reason: Reason | null;
  quantity: number | null;
  /** The one short line that decided it. Never more of the page than that. */
  matchedText: string | null;
  quantityMismatch: boolean;
};
