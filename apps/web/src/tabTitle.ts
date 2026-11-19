// The browser tab: "(12) Proposals · Stock Monitor" while suggestions wait, and an icon with an orange dot while anything needs
// the owner, so it shows from another tab. Pages set their own name; the app sets the count.
let page = "";
let waiting = 0;
let attention = false;

function apply(): void {
  const name = page ? `${page} · Stock Monitor` : "Stock Monitor";
  document.title = waiting > 0 ? `(${waiting}) ${name}` : name;
  const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (icon) icon.href = attention || waiting > 0 ? "/favicon-alert.svg" : "/favicon.svg";
}

export function setPageTitle(title: string): void {
  page = title;
  apply();
}

export function setWaiting(count: number, needsAttention: boolean): void {
  waiting = count;
  attention = needsAttention;
  apply();
}

/** For tests. */
export function resetTabTitleForTests(): void {
  page = "";
  waiting = 0;
  attention = false;
}
