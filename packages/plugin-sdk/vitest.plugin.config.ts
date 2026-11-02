// The SDK's test host for one plugin folder, which `desk plugin test <dir>` runs with vitest:
// the folder is the root, its `tests/*.test.{js,ts}` the tests, in a jsdom page.
// `@endue-ai/plugin-sdk` and `@endue-ai/plugin-sdk/testing` resolve to this package, so a plugin
// anywhere imports them as its page does. Caches stay in this checkout, not in the plugin's folder.
//
//   DESK_PLUGIN_DIR=<folder> node node_modules/vitest/vitest.mjs run --config <this file>

import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const root = process.env.DESK_PLUGIN_DIR;
if (!root) throw new Error("DESK_PLUGIN_DIR names the plugin folder to test");

export default defineConfig({
  root,
  cacheDir: here("../../node_modules/.vite/plugin-test"),
  resolve: {
    alias: [
      { find: /^@endue-ai\/plugin-sdk\/testing$/, replacement: here("./src/testing/index.ts") },
      { find: /^@endue-ai\/plugin-sdk$/, replacement: here("./src/index.ts") },
    ],
  },
  test: {
    include: ["tests/**/*.test.{js,ts}"],
    environment: "jsdom",
    fsModuleCachePath: here("../../node_modules/.vitest-cache/plugin-test"),
  },
});
