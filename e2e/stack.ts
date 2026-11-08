// Starts everything a browser test needs: a throwaway PostgreSQL in Docker, the API serving the
// built web app (npm run build first), and one owner account. Stops cleanly on SIGTERM and SIGINT.
import { fileURLToPath } from "node:url";
import { startTestDb } from "../packages/db/test/harness.js";
import { createLogger } from "../packages/shared/src/index.js";
import { buildApp } from "../apps/api/src/app.js";
import { createOwner } from "../apps/api/src/owner.js";
import { OWNER_EMAIL, OWNER_PASSWORD, PORT } from "./constants.js";

const webRoot = fileURLToPath(new URL("../apps/web/dist", import.meta.url));

const db = await startTestDb();
await createOwner(db.appDb, { email: OWNER_EMAIL, password: OWNER_PASSWORD });

const app = buildApp({ db: db.appDb, logger: createLogger({ level: "warn" }), webRoot });
await app.listen({ port: PORT, host: "127.0.0.1" });
console.log(`e2e stack ready on port ${PORT}`);

let stopping = false;
const stop = async () => {
  if (stopping) return; // Playwright sends both SIGTERM and SIGINT
  stopping = true;
  await app.close();
  await db.stop();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
