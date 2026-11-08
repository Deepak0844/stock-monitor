import type { FastifyInstance, RawReplyDefaultExpression, RawRequestDefaultExpression, RawServerDefault } from "fastify";
import type { Logger } from "pino";
import type { createNotificationRepository } from "@stock-monitor/db";
import { AppError } from "../errors.js";

type App = FastifyInstance<RawServerDefault, RawRequestDefaultExpression, RawReplyDefaultExpression, Logger>;

export type NotificationRoutesDeps = { repo: ReturnType<typeof createNotificationRepository> };

/** What needs the owner's attention, for the dashboard. */
export function registerNotificationRoutes(app: App, { repo }: NotificationRoutesDeps): void {
  app.get("/api/notifications", async () => ({ notifications: await repo.listOpen() }));

  app.post<{ Params: { id: string } }>("/api/notifications/:id/read", async (request) => {
    const { id } = request.params;
    // Reading one that is already read is harmless. Only an unknown or finished one is "not found".
    if (!(await repo.markRead(id)) && !(await repo.listOpen()).some((n) => n.id === id)) {
      throw new AppError(404, "notification_not_found", "That message does not exist.");
    }
    return { ok: true };
  });
}
