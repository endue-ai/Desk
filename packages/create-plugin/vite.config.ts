import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// One Node module with a shebang: the bin that `pnpm create @endue-ai/plugin` runs.
export default defineConfig({
  build: {
    target: "node22",
    outDir: "dist",
    emptyOutDir: true,
    minify: false,
    ssr: fileURLToPath(new URL("./src/bin.ts", import.meta.url)),
    rolldownOptions: {
      output: {
        entryFileNames: "create-plugin.js",
        banner: "#!/usr/bin/env node",
      },
    },
  },
});
