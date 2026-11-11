import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Only the "@/" alias the web app's UI components use. Test selection stays in the npm scripts.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)) } },
});
