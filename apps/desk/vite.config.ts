import { defineConfig } from "vite";

// The CEF shell (apps/desk/shell) serves the built dist/ over desk-app://. `pnpm dev` serves the page
// alone on a fixed port, without a shell: host.ts refuses its commands there.
export default defineConfig({
  clearScreen: false,
  server: { host: "localhost", port: 1420, strictPort: true },
  build: { target: "es2022", outDir: "dist", emptyOutDir: true },
});
