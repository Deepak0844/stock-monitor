// Adds one health.ping job, to prove the worker is running and connected. Run inside the stack.
import { createQueue } from "@stock-monitor/queue";
import { loadConfig } from "@stock-monitor/shared";

const config = loadConfig(process.env);
const queue = createQueue({ connectionString: config.databaseUrl });
await queue.start();
await queue.enqueue("health.ping", { message: process.argv[2] ?? "manual ping" });
await queue.stop();
console.log("health.ping queued");
