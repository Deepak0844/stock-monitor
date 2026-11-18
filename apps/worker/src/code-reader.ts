// Waits for a supplier's login-code email in the supplier Gmail. The inbox is opened read-only: nothing is marked,
// moved or deleted. A code, a subject or an email's text never reaches a log.
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { findCode, senderMatches } from "./code-mail.js";

export type Mail = { from: string; arrived: Date; subject: string; text: string };
/** The mail since a time (IMAP searches by day, so it may return older mail too), newest first. */
export type MailSource = (since: Date) => Promise<Mail[]>;

/** Reads the Gmail inbox over IMAP with its app password. One short connection per look. */
export function createImapSource(c: { user: string; appPassword: string }): MailSource {
  return async (since) => {
    const client = new ImapFlow({ host: "imap.gmail.com", port: 993, secure: true, auth: { user: c.user, pass: c.appPassword }, logger: false, connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000 });
    await client.connect();
    try {
      await client.mailboxOpen("INBOX", { readOnly: true });
      const mails: Mail[] = [];
      const uids = (await client.search({ since }, { uid: true })) || [];
      if (uids.length === 0) return [];
      // The last 20 is plenty: codes are wanted from the last few minutes only.
      for await (const m of client.fetch(uids.slice(-20), { source: true, internalDate: true, envelope: true }, { uid: true })) {
        if (!m.source) continue;
        const parsed = await simpleParser(m.source);
        const from = parsed.from?.value[0]?.address ?? m.envelope?.from?.[0]?.address ?? "";
        const arrived = m.internalDate instanceof Date ? m.internalDate : new Date(m.internalDate ?? 0);
        mails.push({ from, arrived, subject: parsed.subject ?? "", text: parsed.text ?? (typeof parsed.html === "string" ? parsed.html.replace(/<[^>]+>/g, " ") : "") });
      }
      return mails.sort((a, b) => b.arrived.getTime() - a.arrived.getTime());
    } finally {
      await client.logout().catch(() => client.close());
    }
  };
}

const domainOf = (address: string) => address.slice(address.lastIndexOf("@") + 1).toLowerCase();

/**
 * Looks for this login's code until `timeoutMs` has passed. An email counts only when it arrived at or after `since`,
 * comes from the supplier (or its code email sender), and holds a code. Writes one line saying what happened.
 */
export async function waitForCode(
  source: MailSource,
  q: { since: Date; websiteUrl: string; sender: string | null; timeoutMs: number; pollMs: number; log: (line: string) => void; now?: () => number; sleep?: (ms: number) => Promise<void> },
): Promise<string | null> {
  const now = q.now ?? Date.now;
  const sleep = q.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const start = now();
  const waited = () => `${Math.round((now() - start) / 1000)}s`;
  let mismatch: string | null = null;
  let noCodeFrom: string | null = null;
  /** The last look's error. One that worked since then clears it. */
  let failed: string | null;
  for (;;) {
    const look = await source(q.since).then(
      (mails) => ({ mails }),
      (error: unknown) => ({ error: (error as { code?: string }).code ?? "unknown" }),
    );
    failed = "error" in look ? look.error : null;
    if ("mails" in look) {
      const mails = look.mails.filter((m) => m.arrived >= q.since).sort((a, b) => b.arrived.getTime() - a.arrived.getTime());
      for (const m of mails) {
        if (!senderMatches(m.from, q.websiteUrl, q.sender)) {
          mismatch ??= domainOf(m.from);
          continue;
        }
        const code = findCode(`${m.subject}\n${m.text}`);
        if (code) {
          q.log(`code: found from=${domainOf(m.from)} waited=${waited()}`);
          return code;
        }
        noCodeFrom ??= domainOf(m.from);
      }
    }
    if (now() - start + q.pollMs > q.timeoutMs) break;
    await sleep(q.pollMs);
  }
  if (failed) q.log(`code: imap_failed reason=${failed}`);
  else if (noCodeFrom) q.log(`code: no_code_in_email from=${noCodeFrom}`);
  else if (mismatch) q.log(`code: sender_mismatch seen=${mismatch}`);
  else q.log(`code: no_email waited=${waited()}`);
  return null;
}
