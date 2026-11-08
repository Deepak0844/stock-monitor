// A stand-in for the browser service, speaking its real HTTP interface, so the API's client and routes
// are tested against something that behaves like it. It never opens a browser.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export const FAKE_CONTROL_TOKEN = "c".repeat(40);

export type FakeBrowserService = {
  url: string;
  requests: { method: string; path: string; auth: string | undefined; body: unknown }[];
  /** How the next calls behave. */
  behaviour: {
    open: "ok" | "busy" | "fail" | "garbage";
    finish: "ok" | "gone" | "fail" | "garbage";
    cancel: "ok" | "gone" | "fail";
    state: unknown;
    vncPassword: string | undefined;
    /** Wait this long before answering, to test timeouts. */
    delayMs: number;
  };
  close(): Promise<void>;
};

export async function createFakeBrowserService(): Promise<FakeBrowserService> {
  const requests: FakeBrowserService["requests"] = [];
  const behaviour: FakeBrowserService["behaviour"] = {
    open: "ok", finish: "ok", cancel: "ok", state: { cookies: [], origins: [] }, vncPassword: "Ab3dE6gH", delayMs: 0,
  };
  let counter = 0;

  const server: Server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    let body: unknown;
    try {
      body = raw ? JSON.parse(raw) : undefined;
    } catch {
      body = raw;
    }
    const path = (req.url ?? "").split("?")[0] as string;
    requests.push({ method: req.method ?? "", path, auth: req.headers.authorization, body });
    const reply = (status: number, payload?: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(payload === undefined ? undefined : typeof payload === "string" ? payload : JSON.stringify(payload));
    };
    if (behaviour.delayMs) await new Promise((resolve) => setTimeout(resolve, behaviour.delayMs));
    if (req.headers.authorization !== `Bearer ${FAKE_CONTROL_TOKEN}`) return reply(401, { error: "unauthorised" });

    if (req.method === "POST" && path === "/sessions") {
      if (behaviour.open === "busy") return reply(409, { error: "session_open", message: "A login window is already open. Finish or cancel it first." });
      if (behaviour.open === "fail") return reply(502, { error: "window_failed" });
      if (behaviour.open === "garbage") return reply(201, "<html>not json</html>");
      counter += 1;
      return reply(201, {
        id: `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        ...(behaviour.vncPassword ? { vncPassword: behaviour.vncPassword } : {}),
      });
    }
    const finish = /^\/sessions\/([^/]+)\/finish$/.exec(path);
    if (req.method === "POST" && finish) {
      if (behaviour.finish === "gone") return reply(404, { error: "session_not_found" });
      if (behaviour.finish === "fail") return reply(500, { error: "session_failed" });
      if (behaviour.finish === "garbage") return reply(200, { state: "not a session" });
      return reply(200, { state: behaviour.state });
    }
    const cancel = /^\/sessions\/([^/]+)$/.exec(path);
    if (req.method === "DELETE" && cancel) {
      if (behaviour.cancel === "gone") return reply(404, { error: "session_not_found" });
      if (behaviour.cancel === "fail") return reply(500, { error: "session_failed" });
      res.writeHead(204);
      return void res.end();
    }
    reply(404, { error: "not_found" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests,
    behaviour,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
