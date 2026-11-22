// `just perf-database` (ADR 0362): the database plugin's budgets, one file after another in one
// forked process with the collector exposed, outside the default unit run (vitest.config.ts).
import { defineConfig } from "vitest/config";
import root from "../../../vitest.config.ts";

export default defineConfig({
  resolve: root.resolve,
  test: {
    root: new URL("../../..", import.meta.url).pathname,
    include: ["e2e/perf/database/*.perf.ts"],
    globalSetup: ["e2e/perf/database/fresh.ts"],
    fileParallelism: false,
    pool: "forks",
    execArgv: ["--expose-gc"],
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
});
