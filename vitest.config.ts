import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "plugins/*/tests/**/*.test.ts"],
  },
});
