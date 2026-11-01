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
    include: [
      "packages/*/src/**/*.test.ts",
      "apps/*/src/**/*.test.ts",
      "plugins/*/tests/**/*.test.ts",
    ],
  },
});
