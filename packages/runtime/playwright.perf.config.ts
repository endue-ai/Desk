import { defineConfig, devices } from "@playwright/test";

// Performance runs: real time, one worker, WebKit. `just perf-opening` records; nightly will check.
export default defineConfig({
  testDir: "e2e/perf",
  testMatch: "*.perf.ts",
  workers: 1,
  retries: 0,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:4173" },
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
  webServer: {
    command: "pnpm exec vite --config e2e/vite.config.ts",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
  },
});
