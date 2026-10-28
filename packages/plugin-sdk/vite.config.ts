import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// One ES module that Desk serves to plugin frames at /_desk/plugin-sdk.js.
export default defineConfig({
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
    minify: false,
    lib: {
      entry: fileURLToPath(new URL("./src/index.ts", import.meta.url)),
      formats: ["es"],
      fileName: () => "plugin-sdk.js",
    },
  },
});
