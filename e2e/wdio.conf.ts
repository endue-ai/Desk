// App e2e: WebdriverIO + tauri-driver on the packaged app (`just bundle-app`). Linux first; macOS has
// no tauri-driver (ADR 0006), Windows comes later. Run it with `just test-app-e2e`; Playwright is not
// involved (ADR 0018). Spec files run one after another, each in its own WebDriver session and app
// process with a fresh HOME (support/driver.ts). A display comes from outside (`xvfb-run` in CI).
import { existsSync, mkdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { browser } from "@wdio/globals";
import { PORT, saveData, startDriver, stopDriver } from "./support/driver";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const results = join(here, "test-results");
/** The release binary `just bundle-app` writes; DESK_APP points elsewhere (a --debug build). */
const app = resolve(process.env.DESK_APP ?? join(root, "target/release/endue-desk"));

if (process.platform === "darwin") {
  throw new Error(
    "tauri-driver does not run on macOS (ADR 0006); the e2e workflow runs it on Linux",
  );
}
if (!existsSync(app)) {
  throw new Error(`no app at ${app}: run \`just bundle-app\` first, or set DESK_APP`);
}
mkdirSync(results, { recursive: true });

/** The init.yaml in e2e/fixtures each spec starts with; only the launch spec wants the first run. */
const INIT: Record<string, string> = { "launch.spec.ts": "init.yaml" };
const DEFAULT_INIT = "init-no-first-run.yaml";

declare global {
  namespace WebdriverIO {
    interface Capabilities {
      /** tauri-driver turns this into WebKitWebDriver's webkitgtk:browserOptions. */
      "tauri:options"?: { application: string; args?: string[] };
    }
  }
}

/** The spec file this worker runs (wdio starts one worker per spec file). */
let spec = "spec";

const specName = (file: string | undefined) =>
  basename(file?.startsWith("file:") ? fileURLToPath(file) : (file ?? "spec"));
const slug = (title: string) => title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");

export const config: WebdriverIO.Config = {
  runner: "local",
  specs: ["./specs/**/*.spec.ts"],
  maxInstances: 1,
  hostname: "127.0.0.1",
  port: PORT,
  capabilities: [
    {
      // tauri-driver speaks classic WebDriver only.
      "wdio:enforceWebDriverClassic": true,
      "tauri:options": { application: app },
    },
  ],
  logLevel: "warn",
  outputDir: results,
  waitforTimeout: 15_000,
  connectionRetryTimeout: 120_000,
  specFileRetries: 1,
  // The recipes manage no display server: CI wraps them in xvfb-run, people bring their own DISPLAY.
  displayServerEnabled: false,
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: { ui: "bdd", timeout: 60_000 },

  async beforeSession(_config, _capabilities, specs) {
    spec = specName(specs[0]);
    await startDriver({ root, results, spec, init: INIT[spec] ?? DEFAULT_INIT });
  },
  async afterTest(test, _context, { passed }) {
    if (passed) return;
    const name = `${spec}-${slug(test.title)}`;
    await browser.saveScreenshot(join(results, `${name}.png`)).catch(() => {});
    saveData(join(results, `${name}-data`));
  },
  async afterSession() {
    await stopDriver();
  },
};
