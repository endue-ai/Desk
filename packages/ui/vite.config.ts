import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { tokensCss } from "./src/tokens-css";

// dist/ui.js, one ES module for plugin frames' import maps (like dist/plugin-sdk.js); dist/ui.iife.js,
// the same as a classic script for pages opened as plain files; dist/tokens.css and dist/base.css, the
// two sheets a plugin page links (the app serves all four under /_desk/).
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
      name: "desk-sheets",
      generateBundle(options) {
        if (options.format !== "es") return;
        this.emitFile({ type: "asset", fileName: "tokens.css", source: tokensCss() });
        this.emitFile({
          type: "asset",
          fileName: "base.css",
          source: readFileSync(fileURLToPath(new URL("./src/base.css", import.meta.url)), "utf8"),
        });
      },
    },
  ],
});
