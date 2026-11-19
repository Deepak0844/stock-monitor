import { describe, expect, it } from "vitest";
import { createGmailSender, loginAlertMail, sendLoginAlerts } from "./alert-email.js";

const notice = { supplierId: "11111111-1111-4111-8111-111111111111", supplierName: "Acme", message: "Acme is asking you to solve a puzzle (a CAPTCHA). Log in again to solve it." };

describe("the login alert email", () => {
  it("names the supplier and links to its login page in the app", () => {
    expect(loginAlertMail(notice, "https://stock.example.com")).toEqual({
      subject: "Acme needs you to log in",
      text: "Acme is asking you to solve a puzzle (a CAPTCHA). Log in again to solve it.\n\nLog in here: https://stock.example.com/suppliers/11111111-1111-4111-8111-111111111111/connect\n\nSent by Stock Monitor.",
    });
  });

  it("links to localhost when the app's address is not set", () => {
    expect(loginAlertMail(notice, undefined).text).toContain("Log in here: http://localhost:3000/suppliers/11111111-1111-4111-8111-111111111111/connect");
  });
});

describe("the Gmail sender", () => {
  it("gives up on a mail server that accepts the connection and then says nothing", async () => {
    const { createServer } = await import("node:net");
    const sockets: import("node:net").Socket[] = [];
    const server = createServer((s) => void sockets.push(s)); // never answers
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    const send = createGmailSender({ from: "a@example.com", appPassword: "x", to: "b@example.com" }, { host: "127.0.0.1", port, secure: false, timeoutMs: 300 });
    const started = Date.now();
    await expect(send({ subject: "s", text: "t" })).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(3000);
    sockets.forEach((s) => s.destroy());
    server.close();
  });
});

describe("the sweep", () => {
  const logger = { warn: () => {} } as never;
  const n = (id: string) => ({ id, kind: "supplier_needs_reconnect", supplierId: id, supplierName: id, message: "m", reason: "login_required", createdAt: new Date(), readAt: null }) as never;

  it("stops at the first failed send, so a wrong app password tries one login a minute, not ten", async () => {
    let tries = 0;
    const notifications = { unemailedLogin: async () => [n("a"), n("b"), n("c")], claimEmail: async () => true, releaseEmail: async () => {} } as never;
    const sent = await sendLoginAlerts({ notifications, send: async () => void (tries++, (() => { throw Object.assign(new Error("535"), { code: "EAUTH" }); })()), appOrigin: undefined, logger });
    expect(sent).toBe(0);
    expect(tries).toBe(1);
  });

  it("does not throw when releasing a failed send fails too", async () => {
    const notifications = { unemailedLogin: async () => [n("a")], claimEmail: async () => true, releaseEmail: async () => { throw new Error("db down"); } } as never;
    await expect(sendLoginAlerts({ notifications, send: async () => { throw new Error("x"); }, appOrigin: undefined, logger })).resolves.toBe(0);
  });
});
