// What the specs share: the desk shell's two layers and its ready state, plugin frames, and the files
// the app keeps in its data folder under the spec's HOME (support/driver.ts sets it up). The app
// mounts the desk shell (apps/desk/src/main.ts): `#desk.shell` holds the system layer (profiles,
// desktops, the agent bar) and the mode layer, which holds the runtime (plugin surfaces on its grid
// and edges, the status line). Selectors follow the runtime e2e (packages/runtime/e2e/shell*.spec.ts).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { $, browser, expect } from "@wdio/globals";
import { HOME_VAR, LOG_VAR } from "./driver";

/** The status line the runtime shows and `desk_ready` prints once the bridge answered. */
export const READY = "desk ready · bridge: tauri";

/** The shell's layers: the desk's own controls, and what a profile lays out over the runtime. */
export const SYSTEM = '#desk.shell [data-layer="system"]';
export const MODE = '#desk.shell [data-layer="mode"]';

/**
 * A plugin's surface on the runtime under the shell's mode layer, by plugin id: the runtime's own
 * section (`.desk-surface`), which under the shell sits inside a shell window whose `data-surface`
 * is the same id (ADR 0040).
 */
export const surface = (plugin: string) => $(`${MODE} .desk-surface[data-surface="${plugin}"]`);

/** The shell window that holds a plugin's centre surface: its title bar and tools. */
export const windowOf = (plugin: string) => $(`${MODE} section.surface[data-surface="${plugin}"]`);

/** The shell's drawer button (bottom edge); `aria-expanded` says whether the drawer is open. */
export const drawerButton = () => $(`${MODE} .drawer-button`);

/**
 * Wait until the shell is in: both layers are mounted, the status line reads READY (not "desk cannot
 * reach the core ..."), and the agent bar's agents group is no longer busy. The shell clears
 * `aria-busy` when the agent directory was read, which it does after the plugins mounted and the saved
 * session was put back; with no brain the directory is offline and the bar shows `.bar-offline`.
 */
export async function shellReady(): Promise<void> {
  await expect($(SYSTEM)).toExist({ wait: 30_000 });
  await expect($(MODE)).toExist();
  await expect($(`${MODE} footer.desk-status`)).toHaveElementProperty("textContent", READY, {
    wait: 30_000,
  });
  await expect($(`${SYSTEM} .sidebar .bar-group[aria-busy]`)).toHaveAttribute(
    "aria-busy",
    "false",
    { wait: 30_000 },
  );
}

/** Run `body` inside a plugin's sandboxed frame, then return to the shell. */
export async function inFrame<T>(plugin: string, body: () => Promise<T>): Promise<T> {
  const frame = $(`${MODE} .desk-surface[data-surface="${plugin}"] iframe`);
  await frame.waitForExist();
  await browser.switchFrame(frame);
  try {
    return await body();
  } finally {
    await browser.switchFrame(null);
  }
}

/** The plugin whose surface holds the keyboard focus, if any. */
export function focusedSurface(): Promise<string | null> {
  return browser.execute(
    () => document.activeElement?.closest("[data-surface]")?.getAttribute("data-surface") ?? null,
  );
}

/** What the app printed on stdout (and stderr) so far, line by line. */
export function appLog(): string[] {
  const log = process.env[LOG_VAR];
  if (!log) throw new Error(`${LOG_VAR} is not set: run the specs through just test-app-e2e`);
  return readFileSync(log, "utf8").split("\n");
}

/** A JSON file in the app's data folder (Tauri's app_data_dir under HOME), or undefined. */
export function dataFile(name: string): unknown {
  const home = process.env[HOME_VAR];
  if (!home) throw new Error(`${HOME_VAR} is not set: run the specs through just test-app-e2e`);
  try {
    return JSON.parse(readFileSync(join(home, ".local/share/ai.endue.desk", name), "utf8"));
  } catch {
    return undefined;
  }
}

/** Poll a data file until `test` holds, so a relaunch never races the app's own saving. */
export async function waitForData(
  name: string,
  test: (value: unknown) => boolean,
  what: string,
): Promise<void> {
  await browser.waitUntil(async () => test(dataFile(name)), {
    timeout: 10_000,
    timeoutMsg: `${name} never held ${what}`,
  });
}
