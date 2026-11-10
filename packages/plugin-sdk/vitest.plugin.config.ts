// The SDK's test host for one plugin folder, which `desk plugin test <dir>` runs with vitest:
// the folder is the root, its `tests/*.test.{js,ts}` the tests, in a jsdom page.
// `@endue-ai/plugin-sdk` and `@endue-ai/plugin-sdk/testing` resolve to this package, so a plugin
// anywhere imports them as its page does. Caches stay in this checkout, not in the plugin's folder.
// No module cache on disk: vitest keys it by the lockfile nearest the root, the checkout's for a
// plugin inside it and none for one outside, so each change of key cleared the folder runs share,
// and a run clearing it while another wrote there failed with ENOTEMPTY (#139). Without it a run
// takes about 0.1 s longer and nothing grows with each new folder tested.
//
//   DESK_PLUGIN_DIR=<folder> node node_modules/vitest/vitest.mjs run --config <this file>

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const dir = process.env.DESK_PLUGIN_DIR;
if (!dir) throw new Error("DESK_PLUGIN_DIR names the plugin folder to test");
// The folder by its real name: under a Windows 8.3 short name (C:\Users\RUNNER~1\...) the resolver
// sees the test files by another name than the root and cannot load them.
const root = realpathSync.native(dir);

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
    fsModuleCache: false,
  },
});
