import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The "@/" alias the web app's UI components use, and a Toaster for page tests. Test selection stays in the npm scripts.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)) } },
  test: { setupFiles: ["./apps/web/src/test/setup.tsx"] },
});
