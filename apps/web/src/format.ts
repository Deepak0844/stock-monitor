/** A date and time the owner can read, in British English: 10 Nov 2026, 14:30. */
export function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

/** A date without the time, in British English: 10 Nov 2026. */
export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { dateStyle: "medium" });
}

/** How long ago something happened, in plain words: "just now", "12 minutes ago", "3 hours ago", "2 days ago". */
export function formatAgo(iso: string, now: number = Date.now()): string {
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}
