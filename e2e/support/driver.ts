// One driver and one app per spec file; wdio.conf.ts starts them in beforeSession and ends them in
// afterSession. Each spec runs the app with a fresh HOME (the data folder lives under it), its own
// init.yaml, the built-in plugins, the e2e test plugin, the dock fixture, and no brain (ADR 0144). This module starts
// the desk itself (cef.ts) with DESK_REMOTE_DEBUGGING_PORT and a chromedriver
// (chrome-for-testing.ts) that attaches to that port (`goog:chromeOptions.debuggerAddress`). A
// relaunch (browser.reloadSession) quits the app and starts it again with the same HOME and port:
// wdio.conf.ts wraps the command with relaunchApp.
import { type ChildProcess, spawn } from "node:child_process";
import { cpSync, createWriteStream, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { type CefDesk, cefBinary, dataDir, freePort, launchCef } from "./cef";
import { ensureChromedriver } from "./chrome-for-testing";

/** A folder of plugins every spec's app installs as built in: the dock the desk no longer ships (#276). */
export const BUILT_IN_FIXTURES = "e2e/fixtures/built-in";

/**
 * chromedriver's port. Two runs on one machine need two ports: `DESK_E2E_DRIVER_PORT` names another
 * (a second chromedriver on 4444 cannot bind, and the first one's answers would reach the second
 * run's specs).
 */
export const PORT = Number(process.env.DESK_E2E_DRIVER_PORT) || 4444;
/** Where wdio.conf.ts tells the specs the app's HOME and stdout log are (support/desk.ts reads them). */
export const HOME_VAR = "E2E_APP_HOME";
export const LOG_VAR = "E2E_APP_LOG";
/**
 * Where startDriver leaves the running app's pid (e2e/perf finds the app's processes from it). The
 * spec files load their own copy of this module, so its state does not reach them: the environment
 * does.
 */
export const APP_VAR = "E2E_APP_PID";
/** When the running app was started (ms since the epoch): e2e/perf's idle memory waits from it. */
export const APP_STARTED_VAR = "E2E_APP_STARTED";

export interface DriverOptions {
  /** The repository root. */
  root: string;
  /** e2e/test-results: the spec's log goes to `<spec>.log` there. */
  results: string;
  spec: string;
  /** The init.yaml in e2e/fixtures the app starts with. */
  init: string;
  /** Variables to set for the app on top of the spec's (undefined leaves one out): e2e/perf. */
  env?: Record<string, string | undefined>;
}

let driver: ChildProcess | undefined;
let home: string | undefined;
let app: { desk?: CefDesk; start: () => Promise<CefDesk> } | undefined;

/** The runner's environment without XDG_* (so the data folder follows HOME) or DESK_*, plus the spec's. */
export function appEnv(
  root: string,
  appHome: string,
  init: string,
  extra: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!/^(XDG_|DESK_)/.test(key)) env[key] = value;
  }
  const spec: NodeJS.ProcessEnv = {
    ...env,
    HOME: appHome,
    DESK_INIT: join(root, "e2e/fixtures", init),
    // The desk ships no dock (#276). The specs keep one on the bottom edge, installed as a
    // built-in plugin is (its manifest's permissions granted): the edge bar the window manager
    // keeps windows clear of, and the tiles a surface is put away and opened with.
    DESK_PLUGIN_DIRS: [join(root, "plugins"), join(root, BUILT_IN_FIXTURES)].join(delimiter),
    DESK_DEV_PLUGINS: join(root, "e2e/fixtures/plugin-e2e-hello"),
  };
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined) delete spec[key];
    else spec[key] = value;
  }
  return spec;
}

/**
 * Start the spec's driver and its app and wait until both answer. Returns the capabilities the
 * session needs on top of wdio.conf.ts's: the app's DevTools address.
 */
export async function startDriver(options: DriverOptions): Promise<Record<string, unknown>> {
  const { root, results, spec, init, env } = options;
  // A short HOME on macOS: the desk socket's path must stay under its 104 bytes (Library/Application
  // Support/... is long, and the system temp folder is too).
  home = mkdtempSync(join(process.platform === "darwin" ? "/tmp" : tmpdir(), "desk-e2e-"));
  const log = join(results, `${spec}.log`);
  rmSync(log, { force: true });
  process.env[HOME_VAR] = home;
  process.env[LOG_VAR] = log;
  const appHome = home;
  const port = await freePort();
  const start = () =>
    launchCef({
      binary: cefBinary(root),
      env: appEnv(root, appHome, init, env),
      log,
      home: appHome,
      port,
    });
  const binary = await ensureChromedriver();
  const driverLog = join(results, `${spec}.chromedriver.log`);
  await startProcess(binary, [`--port=${PORT}`], driverLog, process.env, "chromedriver");
  const started = Date.now();
  app = { start, desk: await start() };
  setAppPid(app.desk?.pid, started);
  return { "goog:chromeOptions": { debuggerAddress: `127.0.0.1:${port}` } };
}

/**
 * Quit the app as the person does and start it again with the same HOME and port, for
 * browser.reloadSession. The quit ends every page, so the session policy saves on its pagehide.
 */
export async function relaunchApp(): Promise<void> {
  const current = app;
  if (!current) return;
  await current.desk?.stop();
  current.desk = undefined;
  const started = Date.now();
  const desk = await current.start();
  // A test that timed out while this ran has had its session ended: no desk outlives it.
  if (app !== current) return desk.stop();
  current.desk = desk;
  setAppPid(desk.pid, started);
}

function setAppPid(pid: number | undefined, started = Date.now()): void {
  if (pid === undefined) {
    delete process.env[APP_VAR];
    delete process.env[APP_STARTED_VAR];
    return;
  }
  process.env[APP_VAR] = String(pid);
  process.env[APP_STARTED_VAR] = String(started);
}

/** Start a WebDriver server with its output in `log`, and wait until it answers /status. */
async function startProcess(
  command: string,
  args: string[],
  log: string,
  env: NodeJS.ProcessEnv,
  what: string,
): Promise<void> {
  const out = createWriteStream(log, { flags: "a" });
  const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  driver = child;
  // Both streams go to one log; it ends when the driver does.
  child.stdout?.pipe(out, { end: false });
  child.stderr?.pipe(out, { end: false });
  child.once("exit", () => out.end());

  const gone = new Promise<never>((_, reject) => {
    child.once("error", (error) =>
      reject(new Error(`${command} did not start (${error.message}); install ${what}`)),
    );
    child.once("exit", (code) => reject(new Error(`${command} exited (${code}); see ${log}`)));
  });
  gone.catch(() => {});
  await Promise.race([answering(command), gone]);
}

/** The running app's pid (its CEF helpers are processes under it). */
export function appPid(): number | undefined {
  const pid = Number(process.env[APP_VAR]);
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

/** The driver answers /status once it is up. */
async function answering(command: string): Promise<void> {
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
  throw new Error(`${command} did not answer on port ${PORT} within 15 s`);
}

/** Copy the app's data folder (store.json, plugins.json, ...) next to a failed test's screenshot. */
export function saveData(to: string): void {
  const data = home && dataDir(home);
  if (data && existsSync(data))
    cpSync(data, to, { recursive: true, filter: (from) => !from.endsWith(".sock") });
}

/** End the spec's app and driver and remove its HOME. */
export async function stopDriver(): Promise<void> {
  const child = driver;
  driver = undefined;
  await app?.desk?.stop();
  app = undefined;
  setAppPid(undefined);
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    const ended = await Promise.race([exited.then(() => true), delay(5_000).then(() => false)]);
    if (!ended) child.kill("SIGKILL");
  }
  if (home) rmSync(home, { recursive: true, force: true });
  home = undefined;
}
