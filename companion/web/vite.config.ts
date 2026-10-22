import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In development the page runs on its own port and forwards API calls to the companion.
const companion = process.env.EVERYSEAT_COMPANION_URL ?? "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/mcp": companion,
      "/converse": companion,
      "/api": companion,
      "/healthz": companion,
    },
  },
  build: { outDir: "dist", chunkSizeWarningLimit: 1000 },
});
