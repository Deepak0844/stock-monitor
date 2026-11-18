import { describe, expect, it } from "vitest";
import { createImapSource, waitForCode, type Mail, type MailSource } from "./code-reader.js";

const T0 = Date.UTC(2026, 10, 19, 10, 0);
const at = (s: number) => new Date(T0 + s * 1000);
const mail = (over: Partial<Mail> = {}): Mail => ({ from: "noreply@mail.acme.com", arrived: at(5), subject: "Your sign-in code", text: "Your verification code is 482913.", ...over });

/** A fake inbox whose contents change per poll, and a fake clock that the waits move on. */
function setup(polls: Mail[][] | (() => never)) {
  let clock = T0;
  let poll = 0;
  const source: MailSource = async (since) => {
    if (typeof polls === "function") return polls();
    const inbox = polls[Math.min(poll++, polls.length - 1)] ?? [];
    return inbox.filter((m) => m.arrived >= new Date(since.getTime() - 24 * 3600_000)); // like IMAP SINCE: by day
  };
  const lines: string[] = [];
  const q = { since: at(0), websiteUrl: "https://www.acme.com/", sender: null, timeoutMs: 150_000, pollMs: 5000, log: (l: string) => void lines.push(l), now: () => clock, sleep: async (ms: number) => void (clock += ms) };
  return { source, q, lines };
}

describe("waiting for a login code", () => {
  it("returns the code from a matching email that arrives on a later look, and says so once", async () => {
    const { source, q, lines } = setup([[], [mail()]]);
    expect(await waitForCode(source, q)).toBe("482913");
    expect(lines).toEqual(["code: found from=mail.acme.com waited=5s"]);
  });

  it("takes the newest matching email", async () => {
    const { source, q } = setup([[mail({ arrived: at(20), text: "Your code is 222222" }), mail({ arrived: at(10), text: "Your code is 111111" })]]);
    expect(await waitForCode(source, q)).toBe("222222");
  });

  it("never uses an email from before this login, even from the right sender", async () => {
    const { source, q, lines } = setup([[mail({ arrived: at(-60), text: "Your code is 999999" })]]);
    expect(await waitForCode(source, { ...q, timeoutMs: 20_000 })).toBeNull();
    expect(lines).toEqual(["code: no_email waited=20s"]);
  });

  it("does not use another sender's email, and says which domain it saw", async () => {
    const { source, q, lines } = setup([[mail({ from: "alerts@other.com" })]]);
    expect(await waitForCode(source, { ...q, timeoutMs: 20_000 })).toBeNull();
    expect(lines).toEqual(["code: sender_mismatch seen=other.com"]);
  });

  it("uses the code email sender when the supplier has one", async () => {
    const { source, q } = setup([[mail({ from: "codes@login.example.net" })]]);
    expect(await waitForCode(source, { ...q, sender: "login.example.net" })).toBe("482913");
  });

  it("says when the supplier's email holds no code", async () => {
    const { source, q, lines } = setup([[mail({ subject: "Welcome", text: "Thanks for signing in." })]]);
    expect(await waitForCode(source, { ...q, timeoutMs: 20_000 })).toBeNull();
    expect(lines).toEqual(["code: no_code_in_email from=mail.acme.com"]);
  });

  it("finds a code in the subject", async () => {
    const { source, q } = setup([[mail({ subject: "Your code is 557711", text: "Hello" })]]);
    expect(await waitForCode(source, q)).toBe("557711");
  });

  it("keeps trying through inbox errors, then gives up and names the error", async () => {
    const { source, q, lines } = setup(() => {
      throw Object.assign(new Error("Invalid credentials"), { code: "EAUTH" });
    });
    expect(await waitForCode(source, { ...q, timeoutMs: 20_000 })).toBeNull();
    expect(lines).toEqual(["code: imap_failed reason=EAUTH"]);
  });

  it("never logs the code or the subject", async () => {
    const { source, q, lines } = setup([[mail({ subject: "Secret subject 482913" })]]);
    await waitForCode(source, q);
    expect(lines.join("\n")).not.toMatch(/482913|Secret/);
  });
});

describe("the Gmail inbox reader", () => {
  const since = new Date("2026-11-19T02:00:00Z");
  const raw = (from: string, subject: string, body: string) => Buffer.from(`From: ${from}\r\nSubject: ${subject}\r\nContent-Type: text/plain\r\n\r\n${body}\r\n`);
  const box = [
    { uid: 1, internalDate: new Date("2026-11-18T23:00:00Z"), source: raw("noreply@acme.com", "Old code", "Your code is 111111") },
    { uid: 2, internalDate: new Date("2026-11-19T02:01:00Z"), source: raw("Acme <noreply@acme.com>", "Your code", "Your code is 482913") },
  ];

  it("searches from a day earlier (IMAP SINCE is a date), opens the inbox read-only, and downloads only mail from after the login started", async () => {
    const seen: { searched?: Date; readOnly?: boolean; sourceFor: number[] } = { sourceFor: [] };
    const client = {
      connect: async () => {},
      mailboxOpen: async (_name: string, o: { readOnly: boolean }) => void (seen.readOnly = o.readOnly),
      search: async (q: { since: Date }) => ((seen.searched = q.since), box.map((m) => m.uid)),
      async *fetch(range: number[], query: { source?: boolean }) {
        for (const m of box.filter((x) => range.includes(x.uid))) {
          if (query.source) seen.sourceFor.push(m.uid);
          yield { uid: m.uid, internalDate: m.internalDate, ...(query.source ? { source: m.source } : {}) };
        }
      },
      logout: async () => {},
      close: () => {},
    };
    const mails = await createImapSource({ user: "u@example.com", appPassword: "x" }, () => client as never)(since);
    expect(seen.searched?.getTime()).toBe(since.getTime() - 24 * 3600_000);
    expect(seen.readOnly).toBe(true);
    expect(seen.sourceFor).toEqual([2]);
    expect(mails).toEqual([{ from: "noreply@acme.com", arrived: box[1]!.internalDate, subject: "Your code", text: expect.stringContaining("482913") }]);
  });
});
