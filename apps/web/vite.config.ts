import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development, /api goes to the API on port 3000. In production the API serves this build itself.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": "http://localhost:3000" } },
  build: { outDir: "dist" },
});
