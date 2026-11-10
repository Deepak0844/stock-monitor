import { z } from "zod";

// namespace.key, as Shopify shows it under Custom data. The same rule as parseMetafieldName in the shopify package.
const METAFIELD_NAME = /^[A-Za-z0-9_-]{3,255}\.[A-Za-z0-9_-]{2,64}$/;

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
  // Test only: send Shopify requests to a fake server. Refused in production, see below.
  SHOPIFY_BASE_URL_OVERRIDE: z.url().optional(),
  // The browser service (the isolated container that opens supplier websites). Both or neither.
  BROWSER_SERVICE_URL: z.url().optional(),
  BROWSER_CONTROL_TOKEN: z.string().min(32).optional(),
  BROWSER_VNC_PORT: z.coerce.number().int().min(1).max(65535).default(5900),
  // The address people open the app at, for example https://stock.example.com. The live screen only accepts connections from this origin.
  APP_ORIGIN: z.url().optional(),
  // Which product metafields hold the supplier's name and the supplier's page address (the SPU), as namespace.key.
  SHOPIFY_SUPPLIER_NAME_METAFIELD: z.string().regex(METAFIELD_NAME, "must be namespace.key, for example custom.supplier_name").default("custom.supplier_name"),
  SHOPIFY_SPU_METAFIELD: z.string().regex(METAFIELD_NAME, "must be namespace.key, for example custom.spu").default("custom.spu"),
  // The owner's timezone (an IANA name such as Asia/Kolkata): automatic checks keep to the quiet-hours window in this zone.
  APP_TIMEZONE: z
    .string()
    .default("UTC")
    .refine((zone) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: zone });
        return true;
      } catch {
        return false;
      }
    }, "must be a timezone name such as Asia/Kolkata"),
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
  /** Test only. Never set in production: it would let Shopify credentials be sent to another host. */
  shopifyBaseUrlOverride: string | undefined;
  /** Where the browser service listens on the private network, and the token that proves this caller to it. */
  browserServiceUrl: string | undefined;
  browserControlToken: string | undefined;
  /** The VNC port on the browser service's host. */
  browserVncPort: number;
  /** The origin pages are served from, as a browser sends it in the Origin header. Left unset, only localhost on the API's own port is accepted. */
  appOrigin: string | undefined;
  /** The owner's timezone, for the quiet-hours window of automatic checks. */
  timezone: string;
  /** namespace.key of the product metafield holding the supplier's name. */
  shopifySupplierNameMetafield: string;
  /** namespace.key of the product metafield holding the supplier's page address (the SPU). */
  shopifySpuMetafield: string;
};

// An env file with `NAME=` and nothing after it sets the variable to an empty string. For a setting that is optional,
// that means "not set", not "set to nothing".
const BLANK_MEANS_UNSET = ["APP_ORIGIN", "BROWSER_SERVICE_URL", "BROWSER_CONTROL_TOKEN", "BROWSER_VNC_PORT", "SHOPIFY_BASE_URL_OVERRIDE", "APP_TIMEZONE", "SHOPIFY_SUPPLIER_NAME_METAFIELD", "SHOPIFY_SPU_METAFIELD"];

export function loadConfig(input: Record<string, string | undefined>): Config {
  const env = Object.fromEntries(Object.entries(input).filter(([name, value]) => !(value === "" && BLANK_MEANS_UNSET.includes(name))));
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    // Report variable names and reasons only. Never echo the values.
    const problems = parsed.error.issues.map(
      (i) => `${i.path.join(".") || "(root)"}: ${i.code === "invalid_type" ? "missing or wrong type" : i.message}`,
    );
    throw new Error(`Invalid configuration:\n${problems.join("\n")}`);
  }
  const c = parsed.data;
  if (c.NODE_ENV === "production" && c.SHOPIFY_BASE_URL_OVERRIDE) {
    throw new Error("Invalid configuration:\nSHOPIFY_BASE_URL_OVERRIDE: must not be set in production");
  }
  if (c.BROWSER_SERVICE_URL && !c.BROWSER_CONTROL_TOKEN) {
    throw new Error("Invalid configuration:\nBROWSER_CONTROL_TOKEN: required when BROWSER_SERVICE_URL is set");
  }
  if (c.BROWSER_CONTROL_TOKEN && !c.BROWSER_SERVICE_URL) {
    throw new Error("Invalid configuration:\nBROWSER_SERVICE_URL: required when BROWSER_CONTROL_TOKEN is set");
  }
  return {
    nodeEnv: c.NODE_ENV,
    databaseUrl: c.DATABASE_URL,
    encryptionKey: Buffer.from(c.APP_ENCRYPTION_KEY, "base64"),
    port: c.PORT,
    logLevel: c.LOG_LEVEL,
    host: c.HOST,
    cookieSecure: c.COOKIE_SECURE ? c.COOKIE_SECURE === "true" : c.NODE_ENV === "production",
    trustProxy: c.TRUST_PROXY === "true",
    shopifyBaseUrlOverride: c.SHOPIFY_BASE_URL_OVERRIDE,
    browserServiceUrl: c.BROWSER_SERVICE_URL,
    browserControlToken: c.BROWSER_CONTROL_TOKEN,
    browserVncPort: c.BROWSER_VNC_PORT,
    appOrigin: c.APP_ORIGIN ? new URL(c.APP_ORIGIN).origin : undefined,
    timezone: c.APP_TIMEZONE,
    shopifySupplierNameMetafield: c.SHOPIFY_SUPPLIER_NAME_METAFIELD,
    shopifySpuMetafield: c.SHOPIFY_SPU_METAFIELD,
  };
}
