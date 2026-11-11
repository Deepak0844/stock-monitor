/** The words-and-tone helpers return "ok", "warn" or "neutral". The Badge calls the same three success, warning and neutral. */
export const badgeVariant = (tone: "ok" | "warn" | "neutral") => (tone === "ok" ? "success" : tone === "warn" ? "warning" : "neutral") as "success" | "warning" | "neutral";
