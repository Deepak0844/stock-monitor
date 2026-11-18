import nodemailer from "nodemailer";
import type { Logger } from "pino";
import type { createNotificationRepository } from "@stock-monitor/db";

export type SendMail = (mail: { subject: string; text: string }) => Promise<void>;

/** At most this many emails a tick, so a burst of problems cannot hold the tick for long. */
const PER_TICK = 10;

/** Sends through Gmail SMTP from the supplier-only Gmail, with its app password. */
export function createGmailSender(c: { from: string; appPassword: string; to: string }): SendMail {
  const transport = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: c.from, pass: c.appPassword }, connectionTimeout: 15_000 });
  return async (mail) => void (await transport.sendMail({ from: c.from, to: c.to, subject: mail.subject, text: mail.text }));
}

/** The email for one login notice: the notice's own words and a link to the supplier's login page. Never a secret. */
export function loginAlertMail(n: { supplierId: string; supplierName: string; message: string }, appOrigin: string | undefined): { subject: string; text: string } {
  const origin = appOrigin ?? "http://localhost:3000";
  return { subject: `${n.supplierName} needs you to log in`, text: `${n.message}\n\nLog in here: ${origin}/suppliers/${n.supplierId}/connect\n\nSent by Stock Monitor.` };
}

/**
 * Emails each open login notice once. A notice is claimed before the send, so one that closed a moment ago is skipped, and
 * released if the send fails, so the next tick tries again. Returns how many were sent.
 */
export async function sendLoginAlerts(deps: { notifications: ReturnType<typeof createNotificationRepository>; send: SendMail; appOrigin: string | undefined; logger: Logger }): Promise<number> {
  let sent = 0;
  for (const n of await deps.notifications.unemailedLogin(PER_TICK)) {
    if (!(await deps.notifications.claimEmail(n.id))) continue;
    try {
      await deps.send(loginAlertMail(n, deps.appOrigin));
      sent++;
    } catch (error) {
      await deps.notifications.releaseEmail(n.id);
      deps.logger.warn({ supplierId: n.supplierId, code: (error as { code?: string }).code ?? "unknown" }, "alert email could not be sent");
    }
  }
  return sent;
}
