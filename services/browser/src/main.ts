// The browser service's entry point. Everything it needs comes from the environment, and it has no
// database and no encryption key.
import { startBrowserService } from "./service.js";

const token = process.env.CONTROL_TOKEN ?? "";
if (token.length < 32) {
  console.error("CONTROL_TOKEN must be set to at least 32 characters.");
  process.exit(1);
}

const service = await startBrowserService({
  token,
  port: Number(process.env.PORT ?? 8080),
  host: process.env.HOST ?? "0.0.0.0",
  sandbox: process.env.NO_SANDBOX !== "1",
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
