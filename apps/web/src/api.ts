export type Owner = { email: string };

export type ShopifyConnection = {
  shop: string;
  credentialType: "client_credentials" | "static_token";
  scopes: string[];
  locationId: string | null;
  locationName: string | null;
  status: "connected" | "needs_reconnect";
  connectedAt: string;
  lastSuccessfulCallAt: string | null;
};

/** What a connection check found. `scopes` is null when Shopify would not say. */
export type ConnectionCheck = {
  shopName: string;
  scopes: string[] | null;
  writeScopes: string[];
  missingScopes: string[];
  warnings: string[];
};

export type ShopifyDetails =
  | { shop: string; clientId: string; clientSecret: string }
  | { shop: string; accessToken: string };

export type ShopifyLocation = { id: string; name: string };

export type SyncRun = {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "succeeded" | "failed";
  added: number | null;
  updated: number | null;
  unchanged: number | null;
  removed: number | null;
  total: number | null;
  error: string | null;
};

export type ShopifyApi = {
  getConnection(): Promise<ShopifyConnection | null>;
  /** Checks typed-in details, or the saved connection when none are given. Saves nothing. */
  test(details?: ShopifyDetails): Promise<ConnectionCheck>;
  connect(details: ShopifyDetails): Promise<{ connection: ShopifyConnection } & ConnectionCheck>;
  disconnect(): Promise<void>;
  locations(): Promise<ShopifyLocation[]>;
  chooseLocation(id: string): Promise<ShopifyLocation>;
  startSync(): Promise<void>;
  getSync(): Promise<SyncRun | null>;
};

export type Api = {
  /** The signed-in owner, or null when nobody is signed in. */
  getMe(): Promise<Owner | null>;
  login(email: string, password: string): Promise<Owner>;
  logout(): Promise<void>;
  shopify: ShopifyApi;
};

/** A failed request. The message is plain English from the server. The code says which kind of problem. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const NETWORK_MESSAGE = "Can't reach the server. Check your connection and try again.";
const GENERIC_MESSAGE = "Something went wrong. Please try again.";

async function send(path: string, init: { method: string; json?: unknown }): Promise<Response> {
  try {
    return await fetch(path, {
      method: init.method,
      credentials: "same-origin",
      // Only declare a JSON body when there is one, or the server rejects the empty body.
      ...(init.json === undefined
        ? {}
        : { headers: { "content-type": "application/json" }, body: JSON.stringify(init.json) }),
    });
  } catch {
    throw new ApiError(NETWORK_MESSAGE, 0);
  }
}

async function failure(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as { error?: { message?: string; code?: string } };
    return new ApiError(body.error?.message ?? GENERIC_MESSAGE, res.status, body.error?.code ?? null);
  } catch {
    return new ApiError(GENERIC_MESSAGE, res.status);
  }
}

async function request<T>(path: string, init: { method: string; json?: unknown }): Promise<T> {
  const res = await send(path, init);
  if (!res.ok) throw await failure(res);
  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError(GENERIC_MESSAGE, res.status);
  }
}

const shopify: ShopifyApi = {
  async getConnection() {
    return (await request<{ connection: ShopifyConnection | null }>("/api/shopify/connection", { method: "GET" })).connection;
  },
  test: (details) => request("/api/shopify/test", { method: "POST", json: details }),
  connect: (details) => request("/api/shopify/connection", { method: "POST", json: details }),
  async disconnect() {
    await request("/api/shopify/connection", { method: "DELETE" });
  },
  async locations() {
    return (await request<{ locations: ShopifyLocation[] }>("/api/shopify/locations", { method: "GET" })).locations;
  },
  async chooseLocation(id) {
    return (await request<{ location: ShopifyLocation }>("/api/shopify/location", { method: "PUT", json: { id } })).location;
  },
  async startSync() {
    await request("/api/shopify/sync", { method: "POST" });
  },
  async getSync() {
    return (await request<{ lastRun: SyncRun | null }>("/api/shopify/sync", { method: "GET" })).lastRun;
  },
};

export const api: Api = {
  async getMe() {
    const res = await send("/api/me", { method: "GET" });
    if (res.status === 401) return null;
    if (!res.ok) throw await failure(res);
    return (await res.json()) as Owner;
  },
  login: (email, password) => request("/api/login", { method: "POST", json: { email, password } }),
  async logout() {
    await request("/api/logout", { method: "POST" });
  },
  shopify,
};
