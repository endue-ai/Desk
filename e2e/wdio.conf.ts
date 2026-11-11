// App e2e: WebdriverIO on the desk app, one app process per spec file with a fresh HOME
// (support/driver.ts). Run it with `just test-app-e2e`; Playwright is not involved (ADR 0018).
// The app is the desk's debug build (`just build-shell`), driven by chromedriver attached to its
// remote debugging port (ADR 0144). macOS, Linux (under a display: `xvfb-run` in CI), Windows.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { browser } from "@wdio/globals";
import { cefBinary } from "./support/cef";
import { compositorEnv } from "./support/compositor";
import { PORT, relaunchApp, saveData, startDriver, stopDriver } from "./support/driver";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const results = join(here, "test-results");
/** The app: DESK_APP, else the debug build `just build-shell` writes. */
const app = cefBinary(root);

if (!existsSync(app)) {
  throw new Error(`no app at ${app}: run \`just build-shell\` first, or set DESK_APP`);
}
mkdirSync(results, { recursive: true });

/**
 * The init.yaml in e2e/fixtures each spec starts with: only the launch spec wants the first run, and
 * the settings spec starts on values that fail their settings.
 */
const INIT: Record<string, string> = {
  "launch.spec.ts": "init.yaml",
  "settings.spec.ts": "init-bad-values.yaml",
};
const DEFAULT_INIT = "init-no-first-run.yaml";

/**
 * The app's environment a spec adds: persist.spec.ts and keys-follow.spec.ts ask for permissions
 * from e2e.ask, sandbox.spec.ts runs e2e.sandbox's checks in its renderer, the input specs run with
 * the input and drag fixtures (#56), the native plugin spec with the native example (#59), and the
 * accessibility and popup specs with their own fixtures (#57, #156).
 */
const ENV: Record<string, Record<string, string>> = {
  "ime.spec.ts": compositorEnv(root),
  "dnd.spec.ts": compositorEnv(root),
  "a11y.spec.ts": {
    DESK_DEV_PLUGINS: join(root, "e2e/fixtures/plugin-e2e-a11y"),
  },
  "persist.spec.ts": {
    DESK_DEV_PLUGINS: [
      join(root, "e2e/fixtures/plugin-e2e-hello"),
      join(root, "e2e/fixtures/plugin-e2e-ask"),
    ].join(delimiter),
  },
  "sandbox.spec.ts": { DESK_DEV_PLUGINS: join(root, "e2e/fixtures/plugin-e2e-sandbox") },
  "keys-follow.spec.ts": { DESK_DEV_PLUGINS: join(root, "e2e/fixtures/plugin-e2e-ask") },
  "native-plugin.spec.ts": {
    DESK_DEV_PLUGINS: join(root, "examples/plugin-native-wgpu"),
  },
  "popups.spec.ts": { DESK_DEV_PLUGINS: join(root, "e2e/fixtures/plugin-e2e-popup") },
};

/** What a spec builds before its app starts: the native example's program (#59). */
const BUILD: Record<string, string[]> = {
  "native-plugin.spec.ts": ["scripts/example.mjs", "build", "plugin-native-wgpu"],
};

/**
 * Point the session at the desk's main page. The CEF desk has a page per window (the main one, the
 * palette's `?view=palette`, the floating Eris's `?view=eris`), and chromedriver attaches to whichever
 * DevTools lists first, which after a relaunch is often not the main one.
 */
async function toMainPage(): Promise<void> {
  for (const handle of await browser.getWindowHandles()) {
    await browser.switchToWindow(handle);
    if (/^desk-app:\/\/app\/index\.html(?:[?#]|$)/.test(await browser.getUrl())) {
      const url = new URL(await browser.getUrl());
      if (!url.searchParams.has("view")) return;
    }
  }
  throw new Error("the desk's main page is not among the session's windows");
}

/** The spec file this worker runs (wdio starts one worker per spec file). */
let spec = "spec";

const specName = (file: string | undefined) =>
  basename(file?.startsWith("file:") ? fileURLToPath(file) : (file ?? "spec"));
const slug = (title: string) => title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");

/**
 * The session's capabilities: classic WebDriver, because chromedriver attached to a running browser
 * over classic WebDriver leaves its windows alone.
 */
const capabilities: WebdriverIO.Capabilities = {
  browserName: "chrome",
  "wdio:enforceWebDriverClassic": true,
};

export const config: WebdriverIO.Config = {
  runner: "local",
  specs: ["./specs/**/*.spec.ts"],
  maxInstances: 1,
  hostname: "127.0.0.1",
  port: PORT,
  capabilities: [capabilities],
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

  async beforeSession(_config, caps, specs) {
    spec = specName(specs[0]);
    const build = BUILD[spec];
    if (build) execFileSync(process.execPath, build, { cwd: root, stdio: "inherit" });
    const extra = await startDriver({
      root,
      results,
      spec,
      init: INIT[spec] ?? DEFAULT_INIT,
      env: ENV[spec],
    });
    Object.assign(caps, extra);
  },
  async before() {
    // The app is this worker's process, not the driver's: a relaunch quits it and starts it again
    // (support/driver.ts).
    browser.overwriteCommand("reloadSession", async (reload, ...args) => {
      await relaunchApp();
      const session = await reload(...args);
      await toMainPage();
      return session;
    });
    await toMainPage();
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
