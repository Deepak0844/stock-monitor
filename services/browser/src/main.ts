// The browser service's entry point. Everything it needs comes from the environment, and it has no
// database and no encryption key.
import { loadConfig } from "./config.js";
import { startBrowserService } from "./service.js";

let config;
try {
  config = loadConfig(process.env);
} catch (error) {
  console.error(error instanceof Error ? error.message : "The browser service is not set up correctly.");
  process.exit(1);
}

const service = await startBrowserService({
  token: config.token,
  port: config.port,
  host: config.host,
  sandbox: config.sandbox,
  headedWindows: config.headed,
  sessionTimeoutMs: config.sessionTimeoutMs,
  vncPassword: config.vncPassword,
  guard: config.allowHosts ? { allowHosts: config.allowHosts } : undefined,
  log: (line) => console.log(line),
});
console.log(`browser service listening at ${service.url}`);

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await service.close();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
