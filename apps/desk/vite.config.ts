import { defineConfig } from "vite";

// Tauri serves the dev server on a fixed port and bundles dist/ for release builds.
export default defineConfig({
  clearScreen: false,
  server: { host: "localhost", port: 1420, strictPort: true },
  build: { target: "es2022", outDir: "dist", emptyOutDir: true },
});
