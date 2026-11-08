import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url(),
  APP_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, "must be 32 bytes, base64 encoded"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  HOST: z.string().min(1).default("127.0.0.1"),
  COOKIE_SECURE: z.enum(["true", "false"]).optional(),
  TRUST_PROXY: z.enum(["true", "false"]).default("false"),
});

export type Config = {
  nodeEnv: "development" | "test" | "production";
  databaseUrl: string;
  encryptionKey: Buffer;
  port: number;
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace";
  host: string;
  /** Send the session cookie only over HTTPS. Defaults to on in production. */
  cookieSecure: boolean;
  /** Believe X-Forwarded-For. Only turn on behind a proxy that overwrites that header. */
  trustProxy: boolean;
};

export function loadConfig(env: Record<string, string | undefined>): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    // Report variable names and reasons only. Never echo the values.
    const problems = parsed.error.issues.map(
      (i) => `${i.path.join(".") || "(root)"}: ${i.code === "invalid_type" ? "missing or wrong type" : i.message}`,
    );
    throw new Error(`Invalid configuration:\n${problems.join("\n")}`);
  }
  const c = parsed.data;
  return {
    nodeEnv: c.NODE_ENV,
    databaseUrl: c.DATABASE_URL,
    encryptionKey: Buffer.from(c.APP_ENCRYPTION_KEY, "base64"),
    port: c.PORT,
    logLevel: c.LOG_LEVEL,
    host: c.HOST,
    cookieSecure: c.COOKIE_SECURE ? c.COOKIE_SECURE === "true" : c.NODE_ENV === "production",
    trustProxy: c.TRUST_PROXY === "true",
  };
}
