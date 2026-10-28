import { defineConfig, devices } from "@playwright/test";
import { baseURL, webServer } from "./e2e/port";

const ci = Boolean(process.env.CI);

export default defineConfig({
  testDir: "e2e",
  // Render trees are OS-independent, so one snapshot per test serves every platform.
  snapshotPathTemplate: "{testDir}/__snapshots__/{testFileName}/{arg}{ext}",
  fullyParallel: true,
  forbidOnly: ci,
  retries: ci ? 2 : 0,
  reporter: ci ? [["github"], ["list"]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
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
