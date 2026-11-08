// A small stand-in for Shopify, used only in tests. It speaks real HTTP so clients are tested
// end to end. Shapes follow Shopify's documentation for the client credentials grant.
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export type RecordedRequest = {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
};

export type FakeShopifyOptions = {
  clientId?: string;
  clientSecret?: string;
  scope?: string;
  expiresIn?: number;
};

export type GraphQLRequest = {
  token: string | undefined;
  version: string;
  query: string;
  variables: Record<string, unknown> | undefined;
};
export type GraphQLReply = { status?: number; headers?: Record<string, string>; body: unknown };
export type GraphQLHandler = (request: GraphQLRequest, count: number) => GraphQLReply | Promise<GraphQLReply>;

export type FakeMode = "ok" | "wrong_organization" | "server_error" | "throttled" | "not_json" | "redirect";

export type FakeShopify = {
  /** Base URL, for example http://127.0.0.1:50321 */
  url: string;
  requests: RecordedRequest[];
  tokenRequests: () => RecordedRequest[];
  setMode: (mode: FakeMode, redirectTo?: string) => void;
  /** What the GraphQL endpoint answers. The default returns a shop name. */
  setGraphQL: (handler: GraphQLHandler) => void;
  graphqlRequests: () => RecordedRequest[];
  /** Make every token issued so far stop working, as if the secret had been rotated. */
  revokeIssuedTokens: () => void;
  /** Accept a fixed token, like a legacy permanent token. */
  allowToken: (token: string) => void;
  close: () => Promise<void>;
};

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body));
  });

export async function createFakeShopify(options: FakeShopifyOptions = {}): Promise<FakeShopify> {
  const clientId = options.clientId ?? "fake-client-id";
  const clientSecret = options.clientSecret ?? "fake-client-secret";
  let mode: FakeMode = "ok";
  let redirectTo = "";
  let issued = 0;
  const validTokens = new Set<string>();
  const requests: RecordedRequest[] = [];
  let graphqlCount = 0;
  let graphql: GraphQLHandler = () => ({ body: { data: { shop: { name: "Fake Store" } } } });

  const server: Server = createServer(async (req, res) => {
    const body = await readBody(req);
    requests.push({ method: req.method ?? "", path: req.url ?? "", headers: req.headers, body });
    const send = (status: number, payload: unknown, type = "application/json") => {
      res.writeHead(status, { "content-type": type });
      res.end(typeof payload === "string" ? payload : JSON.stringify(payload));
    };

    const graphqlMatch = /^\/admin\/api\/([^/]+)\/graphql\.json$/.exec(req.url ?? "");
    if (req.method === "POST" && graphqlMatch) {
      const token = req.headers["x-shopify-access-token"];
      if (typeof token !== "string" || !validTokens.has(token)) {
        return send(401, { errors: "Invalid access token." });
      }
      let parsed: { query?: string; variables?: Record<string, unknown> };
      try {
        parsed = JSON.parse(body);
      } catch {
        return send(400, { errors: "Bad request." });
      }
      graphqlCount += 1;
      const reply = await graphql(
        { token, version: graphqlMatch[1]!, query: parsed.query ?? "", variables: parsed.variables },
        graphqlCount,
      );
      if (reply.headers) {
        res.writeHead(reply.status ?? 200, reply.headers);
        return res.end(typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body));
      }
      return send(reply.status ?? 200, reply.body);
    }

    if (req.method !== "POST" || req.url !== "/admin/oauth/access_token") return send(404, { error: "not found" });
    if (mode === "redirect") {
      res.writeHead(307, { location: redirectTo });
      return res.end();
    }
    if (mode === "wrong_organization") {
      return send(400, "Oauth error shop_not_permitted: Client credentials cannot be performed on this shop.", "text/plain");
    }
    if (mode === "server_error") return send(500, { error: "boom" });
    if (mode === "throttled") return send(429, { error: "slow down" });
    if (mode === "not_json") return send(200, "<html>not json</html>", "text/html");

    const form = new URLSearchParams(body);
    const valid =
      req.headers["content-type"]?.startsWith("application/x-www-form-urlencoded") &&
      form.get("grant_type") === "client_credentials" &&
      form.get("client_id") === clientId &&
      form.get("client_secret") === clientSecret;
    if (!valid) return send(400, { error: "invalid_client" });

    issued += 1;
    validTokens.add(`fake-access-token-${issued}`);
    return send(200, {
      access_token: `fake-access-token-${issued}`,
      scope: options.scope ?? "read_products,read_inventory",
      expires_in: options.expiresIn ?? 86399,
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    tokenRequests: () => requests.filter((r) => r.path === "/admin/oauth/access_token"),
    setMode: (next, to = "") => {
      mode = next;
      redirectTo = to;
    },
    setGraphQL: (handler) => {
      graphql = handler;
    },
    graphqlRequests: () => requests.filter((r) => /graphql\.json$/.test(r.path)),
    revokeIssuedTokens: () => validTokens.clear(),
    allowToken: (token) => void validTokens.add(token),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
