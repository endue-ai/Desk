import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { tokensCss } from "./src/tokens-css";

// dist/ui.js, one ES module for plugin frames' import maps (like dist/plugin-sdk.js); dist/ui.iife.js,
// the same as a classic script for pages opened as plain files; and dist/tokens.css.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
    minify: false,
    lib: {
      entry: fileURLToPath(new URL("./src/bundle.ts", import.meta.url)),
      name: "DeskUI",
      formats: ["es", "iife"],
      fileName: (format) => (format === "es" ? "ui.js" : "ui.iife.js"),
    },
  },
  plugins: [
    {
      name: "desk-tokens-css",
      generateBundle(options) {
        if (options.format !== "es") return;
        this.emitFile({ type: "asset", fileName: "tokens.css", source: tokensCss() });
      },
    },
  ],
});
