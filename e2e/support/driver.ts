// One tauri-driver per spec file; wdio.conf.ts starts it in beforeSession and ends it in afterSession.
// Its environment reaches the app through WebKitWebDriver, which inherits it: so each spec runs the
// app with a fresh HOME (the data folder ~/.local/share/ai.endue.desk and WebKit's storage live under
// it), its own init.yaml, the built-in plugins, the e2e test plugin, and no brain.
import { type ChildProcess, spawn } from "node:child_process";
import { cpSync, createWriteStream, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

/** tauri-driver's port; it starts WebKitWebDriver on 4445. */
export const PORT = 4444;
/** Where wdio.conf.ts tells the specs the app's HOME and stdout log are (support/desk.ts reads them). */
export const HOME_VAR = "E2E_APP_HOME";
export const LOG_VAR = "E2E_APP_LOG";

export interface DriverOptions {
  /** The repository root. */
  root: string;
  /** e2e/test-results: the spec's log goes to `<spec>.log` there. */
  results: string;
  spec: string;
  /** The init.yaml in e2e/fixtures the app starts with. */
  init: string;
}

let driver: ChildProcess | undefined;
let home: string | undefined;

/** The runner's environment without XDG_* (so the data folder follows HOME) or DESK_*, plus the spec's. */
export function appEnv(root: string, appHome: string, init: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!/^(XDG_|DESK_)/.test(key)) env[key] = value;
  }
  return {
    ...env,
    HOME: appHome,
    DESK_INIT: join(root, "e2e/fixtures", init),
    DESK_PLUGIN_DIRS: join(root, "plugins"),
    DESK_DEV_PLUGINS: join(root, "e2e/fixtures/plugin-e2e-hello"),
  };
}

/** Start tauri-driver for one spec file and wait until it answers. */
export async function startDriver(options: DriverOptions): Promise<void> {
  const { root, results, spec, init } = options;
  home = mkdtempSync(join(tmpdir(), "desk-e2e-"));
  const log = join(results, `${spec}.log`);
  const out = createWriteStream(log);
  const child = spawn(
    "tauri-driver",
    ["--port", String(PORT), "--native-driver", join(root, "e2e/driver/webkit-webdriver.sh")],
    { env: appEnv(root, home, init), stdio: ["ignore", "pipe", "pipe"] },
  );
  driver = child;
  // Both streams go to one log; it ends when the driver does.
  child.stdout?.pipe(out, { end: false });
  child.stderr?.pipe(out, { end: false });
  child.once("exit", () => out.end());
  process.env[HOME_VAR] = home;
  process.env[LOG_VAR] = log;

  const gone = new Promise<never>((_, reject) => {
    child.once("error", (error) =>
      reject(
        new Error(`tauri-driver did not start (${error.message}); install tauri-driver 2.1.0`),
      ),
    );
    child.once("exit", (code) => reject(new Error(`tauri-driver exited (${code}); see ${log}`)));
  });
  gone.catch(() => {});
  await Promise.race([answering(), gone]);
}

/** tauri-driver forwards /status to WebKitWebDriver: it answers once both are up. */
async function answering(): Promise<void> {
  const until = Date.now() + 15_000;
  while (Date.now() < until) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/status`);
      if (response.ok) return;
    } catch {
      // not listening yet
    }
    await delay(100);
  }
  throw new Error(`tauri-driver did not answer on port ${PORT} within 15 s`);
}

/** Copy the app's data folder (store.json, plugins.json, ...) next to a failed test's screenshot. */
export function saveData(to: string): void {
  const data = home && join(home, ".local/share/ai.endue.desk");
  if (data && existsSync(data)) cpSync(data, to, { recursive: true });
}

/** End the spec's tauri-driver (it ends WebKitWebDriver) and remove its HOME. */
export async function stopDriver(): Promise<void> {
  const child = driver;
  driver = undefined;
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    const ended = await Promise.race([exited.then(() => true), delay(5_000).then(() => false)]);
    if (!ended) child.kill("SIGKILL");
  }
  if (home) rmSync(home, { recursive: true, force: true });
  home = undefined;
}
