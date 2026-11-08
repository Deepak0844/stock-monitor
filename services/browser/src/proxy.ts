import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, request as httpRequest, type IncomingMessage } from "node:http";
import { connect, type AddressInfo, type Socket } from "node:net";
import type { Guard } from "./guard.js";

export type BlockedSummary = { count: number; privateAddress: boolean };
export type GuardTracker = { blocked(): BlockedSummary; stop(): void };
export type GuardProxy = {
  port: number;
  /** The password each check's context presents. Only this service's own Chromium knows it. */
  secret: string;
  /** Starts counting what is refused for one check. The check's id is the proxy user name. */
  track(id: string): GuardTracker;
  close(): Promise<void>;
};

const digest = (s: string) => createHash("sha256").update(s).digest();
const STATUS = { private: "403 Forbidden", not_found: "502 Bad Gateway" } as const;

/**
 * A proxy on this machine that all of Chromium's traffic goes through. It resolves each name itself,
 * refuses private addresses, and connects to the address it checked. Because it sees every
 * connection, redirects, images, scripts and WebSockets are covered as well as the first page.
 */
export async function startGuardProxy(guard: Guard): Promise<GuardProxy> {
  const secret = randomBytes(24).toString("hex");
  const secretDigest = digest(secret);
  const trackers = new Map<string, BlockedSummary>();
  const sockets = new Set<Socket>();

  /** The check's id when the credentials are right, otherwise null. */
  const authenticate = (header: string | undefined): string | null => {
    const encoded = /^Basic (.+)$/.exec(header ?? "")?.[1];
    if (!encoded) return null;
    const text = Buffer.from(encoded, "base64").toString("utf8");
    const split = text.indexOf(":");
    if (split < 0) return null;
    return timingSafeEqual(digest(text.slice(split + 1)), secretDigest) ? text.slice(0, split) : null;
  };
  const refuse = (id: string, reason: "private" | "not_found") => {
    const t = trackers.get(id);
    if (!t) return;
    t.count += 1;
    if (reason === "private") t.privateAddress = true;
  };
  const NEED_AUTH = 'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="guard"\r\nConnection: close\r\nContent-Length: 0\r\n\r\n';

  const server = createServer(async (req: IncomingMessage, res) => {
    const id = authenticate(req.headers["proxy-authorization"]);
    if (id === null) {
      res.writeHead(407, { "proxy-authenticate": 'Basic realm="guard"', connection: "close" });
      return void res.end();
    }
    let url: URL;
    try {
      url = new URL(req.url ?? "");
    } catch {
      res.writeHead(400);
      return void res.end();
    }
    if (url.protocol !== "http:") {
      res.writeHead(400);
      return void res.end();
    }
    const port = Number(url.port || 80);
    const verdict = await guard.check(url.hostname, port);
    if (!verdict.allowed) {
      refuse(id, verdict.reason);
      // Chromium shows a proxy's answer as if it were the page, so the answer says it came from the guard.
      res.writeHead(Number.parseInt(STATUS[verdict.reason]), { "x-guard-blocked": verdict.reason, connection: "close" });
      return void res.end();
    }
    const headers = { ...req.headers };
    delete headers["proxy-authorization"];
    delete headers["proxy-connection"];
    const upstream = httpRequest({ host: verdict.address, port, method: req.method, path: url.pathname + url.search, headers }, (answer) => {
      res.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(res);
    });
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  });

  server.on("connect", async (req: IncomingMessage, client: Socket, head: Buffer) => {
    client.on("error", () => client.destroy());
    const id = authenticate(req.headers["proxy-authorization"]);
    if (id === null) return void client.end(NEED_AUTH);
    const target = /^(.+):(\d+)$/.exec(req.url ?? "");
    if (!target) return void client.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    const port = Number(target[2]);
    const verdict = await guard.check(target[1] as string, port);
    if (!verdict.allowed) {
      refuse(id, verdict.reason);
      return void client.end(`HTTP/1.1 ${STATUS[verdict.reason]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    }
    const upstream = connect({ host: verdict.address, port });
    sockets.add(upstream);
    const end = () => {
      upstream.destroy();
      client.destroy();
      sockets.delete(upstream);
    };
    upstream.on("error", end);
    upstream.on("close", end);
    client.on("close", end);
    upstream.once("connect", () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length > 0) upstream.write(head);
      upstream.pipe(client);
      client.pipe(upstream);
    });
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  return {
    port: (server.address() as AddressInfo).port,
    secret,
    track(id) {
      const summary: BlockedSummary = { count: 0, privateAddress: false };
      trackers.set(id, summary);
      return { blocked: () => ({ ...summary }), stop: () => void trackers.delete(id) };
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
