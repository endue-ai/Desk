import { defineConfig, devices } from "@playwright/test";
import { e2eGuard } from "../../scripts/e2e/guard.mjs";
import { baseURL, webServer } from "./e2e/port";

const ci = Boolean(process.env.CI);
// Run through `just test-e2e` only: on macOS this refuses native WebKit that the runner did not start
// and caps the workers everywhere (ADR 0018).
const guard = e2eGuard();

export default defineConfig({
  testDir: "e2e",
  // Render trees are OS-independent, so one snapshot per test serves every platform.
  snapshotPathTemplate: "{testDir}/__snapshots__/{testFileName}/{arg}{ext}",
  fullyParallel: true,
  forbidOnly: ci,
  retries: ci ? 2 : 0,
  reporter: ci ? [["github"], ["list"]] : "list",
  ...(guard.workers ? { workers: guard.workers } : {}),
  use: {
    baseURL,
    trace: "retain-on-failure",
    ...guard.use,
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
