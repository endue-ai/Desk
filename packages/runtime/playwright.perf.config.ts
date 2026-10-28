import { defineConfig, devices } from "@playwright/test";
import { baseURL, webServer } from "./e2e/port";

// Performance runs: real time, one worker, WebKit. `just perf-opening` records; nightly will check.
export default defineConfig({
  testDir: "e2e/perf",
  testMatch: "*.perf.ts",
  workers: 1,
  retries: 0,
  reporter: "list",
  use: { baseURL },
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
