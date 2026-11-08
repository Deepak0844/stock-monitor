export type Config = {
  token: string;
  port: number;
  host: string;
  /** Chromium's own sandbox. */
  sandbox: boolean;
  /** Live windows open in a real (virtual) display. Off only for a machine with none. */
  headed: boolean;
  sessionTimeoutMs: number;
  /** Test only: "host:port" pairs the guard lets through. */
  allowHosts: string[] | undefined;
};

const MIN_TOKEN = 32;

function whole(name: string, value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be a whole number from ${min} to ${max}.`);
  return n;
}

/** Reads the service's settings. It throws a plain message for anything unsafe, so a bad setup never starts. */
export function loadConfig(env: Record<string, string | undefined>): Config {
  const token = env.CONTROL_TOKEN ?? "";
  if (token.length < MIN_TOKEN) throw new Error(`CONTROL_TOKEN must be set to at least ${MIN_TOKEN} characters.`);

  // The allow list lets addresses on this machine through. A production service must never have it.
  const allow = env.TEST_ALLOW_HOSTS?.split(",").map((s) => s.trim()).filter(Boolean);
  if (allow && allow.length > 0 && (env.NODE_ENV ?? "production") === "production") {
    throw new Error("TEST_ALLOW_HOSTS must not be set in production.");
  }

  return {
    token,
    port: whole("PORT", env.PORT, 8080, 1, 65535),
    host: env.HOST ?? "0.0.0.0",
    sandbox: env.NO_SANDBOX !== "1",
    headed: env.HEADLESS_WINDOWS !== "1",
    sessionTimeoutMs: whole("SESSION_MINUTES", env.SESSION_MINUTES, 15, 1, 120) * 60_000,
    allowHosts: allow && allow.length > 0 ? allow : undefined,
  };
}
