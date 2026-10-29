import { defineConfig, devices } from "@playwright/test";
import { e2eGuard } from "../../scripts/e2e/guard.mjs";
import { baseURL, webServer } from "./e2e/port";

// Performance runs: real time, one worker, WebKit. `just perf-opening` records; nightly will check.
// On macOS only a person runs it, with the machine's e2e slots to itself (ADR 0018).
const guard = e2eGuard();

export default defineConfig({
  testDir: "e2e/perf",
  testMatch: "*.perf.ts",
  workers: 1,
  retries: 0,
  reporter: "list",
  use: { baseURL, ...guard.use },
  projects: [
    {
      name: "webkit",
      use: {
        ...devices["Desktop Safari"],
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
      },
    },
  ],
  webServer,
});
