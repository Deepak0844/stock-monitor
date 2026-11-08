export type Owner = { email: string };

export type Api = {
  /** The signed-in owner, or null when nobody is signed in. */
  getMe(): Promise<Owner | null>;
  login(email: string, password: string): Promise<Owner>;
  logout(): Promise<void>;
};

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
    throw new Error(NETWORK_MESSAGE);
  }
}

async function messageFrom(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } };
    return body.error?.message ?? GENERIC_MESSAGE;
  } catch {
    return GENERIC_MESSAGE;
  }
}

export const api: Api = {
  async getMe() {
    const res = await send("/api/me", { method: "GET" });
    if (res.status === 401) return null;
    if (!res.ok) throw new Error(await messageFrom(res));
    return (await res.json()) as Owner;
  },
  async login(email, password) {
    const res = await send("/api/login", { method: "POST", json: { email, password } });
    if (!res.ok) throw new Error(await messageFrom(res));
    return (await res.json()) as Owner;
  },
  async logout() {
    const res = await send("/api/logout", { method: "POST" });
    if (!res.ok) throw new Error(await messageFrom(res));
  },
};
