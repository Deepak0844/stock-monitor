import type { LinkStatus, Mapping } from "../api.js";

type Tone = "ok" | "warn" | "neutral";

const STATUS: Record<LinkStatus, { words: string; tone: Tone; hint?: string }> = {
  not_checked: { words: "Not checked", tone: "neutral" },
  works: { words: "Works", tone: "ok" },
  never_worked: { words: "Never worked", tone: "warn", hint: "This address never loaded the right page. Check it." },
  page_missing: { words: "Page missing", tone: "warn", hint: "The page is gone. The product may be discontinued." },
  moved: { words: "Moved", tone: "warn", hint: "The supplier sends this address somewhere else." },
  looks_different: { words: "Looks different", tone: "warn", hint: "The page changed. Check it is still the same product." },
  needs_login: { words: "Needs login", tone: "neutral", hint: "The supplier asked for a login or blocked the check. The link is not marked broken." },
  could_not_check: { words: "Could not check", tone: "neutral", hint: "Nothing was concluded. Try again later." },
};

/** What a link's status is called on screen, and a plain sentence about what to do. Words, never colour alone. */
export const linkStatusOf = (m: Pick<Mapping, "linkStatus">) => STATUS[m.linkStatus];
export const LINK_STATUS_OPTIONS = (Object.keys(STATUS) as LinkStatus[]).map((value) => ({ value, words: STATUS[value].words }));
