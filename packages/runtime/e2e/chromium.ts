import { fileURLToPath } from "node:url";
import { devices } from "@playwright/test";
import { headlessShellPath } from "../../../e2e/support/chrome-for-testing";

// The engine the runtime e2e and perf run on (ADR 0144): Chrome for Testing's headless shell of the CEF
// desk's own Chromium build, pinned in e2e/driver/chrome-for-testing.json, not Playwright's bundled
// one, an earlier build of the branch whose renderer is killed when a just-created field takes the
// focus. `chromiumSetup` fetches it once before the workers start; DESK_E2E_CHROMIUM names another.
export const chromium = {
  ...devices["Desktop Chrome"],
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  launchOptions: { executablePath: headlessShellPath() },
};

/** The configs' globalSetup: the pinned headless shell, downloaded and checked on the first run. */
export const chromiumSetup = fileURLToPath(new URL("./chromium-setup.ts", import.meta.url));
