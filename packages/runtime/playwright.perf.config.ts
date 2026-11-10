import { defineConfig } from "@playwright/test";
import { e2eGuard } from "../../scripts/e2e/guard.mjs";
import { chromium, chromiumSetup } from "./e2e/chromium";
import { baseURL, webServer } from "./e2e/port";

// Performance runs: real time, one worker, headless Chromium (ADR 0144). `just perf-opening` checks;
// `just perf-opening record` writes the baseline. Record on a quiet machine: other runs share its cores.
const guard = e2eGuard();

export default defineConfig({
  testDir: "e2e/perf",
  testMatch: "*.perf.ts",
  workers: guard.workers ?? 1,
  retries: 0,
  reporter: "list",
  use: { baseURL },
  projects: [
    {
      name: "chromium",
      use: chromium,
    },
  ],
  globalSetup: chromiumSetup,
  webServer,
});
