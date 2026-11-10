import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // The library plugin endue.formats as plugins import it: the desk serves plugins/formats/lib/ at
    // /endue.formats/lib/, and each consumer's page maps @endue-ai/formats/ there (#181).
    alias: [
      {
        find: /^@endue-ai\/formats\//,
        replacement: fileURLToPath(new URL("./plugins/formats/lib/", import.meta.url)),
      },
    ],
  },
  test: {
    // The window manager the runtime's tests run, built as WebAssembly when it is stale (#83).
    globalSetup: ["./scripts/desk-wm-wasm.mjs"],
    include: [
      "packages/*/src/**/*.test.ts",
      "apps/*/src/**/*.test.ts",
      "plugins/*/tests/**/*.test.ts",
      "examples/*/tests/**/*.test.ts",
      "e2e/perf/lib/*.test.ts",
      "e2e/support/*.test.ts",
    ],
  },
});
