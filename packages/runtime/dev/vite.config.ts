import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { pluginFiles } from "../e2e/vite.config";

const repo = fileURLToPath(new URL("../../../", import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  // The palette is a UI plugin: its files are served as in the e2e fixture.
  plugins: [pluginFiles()],
  server: { host: "127.0.0.1", port: 5173, fs: { allow: [repo] } },
});
