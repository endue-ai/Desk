// What the specs share: the desk shell's two layers and its ready state, plugin frames, and the files
// the app keeps in its data folder under the spec's HOME (support/driver.ts sets it up). The app
// mounts the desk shell (apps/desk/src/main.ts): `#desk.shell` holds the system layer (profiles,
// desktops, the agent bar) and the mode layer, which holds the runtime (plugin surfaces on its grid
// and edges, the status line). Selectors follow the runtime e2e (packages/runtime/e2e/shell*.spec.ts).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { $, browser, expect } from "@wdio/globals";
import { dataDir } from "./cef";
import { HOME_VAR, LOG_VAR } from "./driver";

/** The status line the runtime shows and `desk_ready` prints once the bridge answered. */
export const READY = "desk ready · bridge: cef";

/** The shell's layers: the desk's own controls, and what a profile lays out over the runtime. */
export const SYSTEM = '#desk.shell [data-layer="system"]';
export const MODE = '#desk.shell [data-layer="mode"]';

/**
 * A plugin's surface on the runtime under the shell's mode layer, by plugin id: the runtime's own
 * section (`.desk-surface`), which under the shell sits inside a shell window whose `data-surface`
 * is the same id (ADR 0040).
 */
export const surface = (plugin: string) => $(`${MODE} .desk-surface[data-surface="${plugin}"]`);

/** The shell window that holds a plugin's content or side panel: its title bar and tools. */
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

/**
 * Whether the desk runs on the compositor (`DESK_COMPOSITOR=1`, #81, ADR 0151): its plugin frames
 * are stand-ins, each plugin's page an off-screen browser of its own, and the compositor draws the
 * windows the page leaves unpainted.
 */
export async function composited(): Promise<boolean> {
  return (await browser.getUrl()).includes("compositor=1");
}

/** Run `body` in a plugin's own off-screen browser (compositor mode), then return to the shell. */
async function inSurface<T>(plugin: string, body: () => Promise<T>): Promise<T> {
  const frame = $(`#desk.shell .desk-surface[data-surface="${plugin}"] iframe`);
  await frame.waitForExist();
  const host = /^desk-plugin:\/\/([^/?#]+)/.exec((await frame.getAttribute("src")) ?? "")?.[1];
  const shell = await browser.getWindowHandle();
  await browser.waitUntil(
    async () => {
      for (const handle of await browser.getWindowHandles()) {
        if (handle === shell) continue;
        await browser.switchToWindow(handle);
        if ((await browser.getUrl()).startsWith(`desk-plugin://${host}/`)) return true;
      }
      await browser.switchToWindow(shell);
      return false;
    },
    { timeout: 15_000, timeoutMsg: `${plugin} has no surface of its own` },
  );
  try {
    return await body();
  } finally {
    await browser.switchToWindow(shell);
  }
}

/**
 * Run `body` inside a plugin's sandboxed frame, then return to the shell. The frame is looked up in
 * any layer: endue.permissions' prompt is an overlay surface. On the compositor's desk, inside the
 * plugin's own browser.
 */
export async function inFrame<T>(plugin: string, body: () => Promise<T>): Promise<T> {
  if (await composited()) return inSurface(plugin, body);
  const frame = $(`#desk.shell .desk-surface[data-surface="${plugin}"] iframe`);
  await frame.waitForExist();
  await browser.switchFrame(frame);
  try {
    return await body();
  } finally {
    await browser.switchFrame(null);
  }
}

/**
 * Press a button by its selector in the current frame. The desk lays every plugin of the Default
 * profile out at once, so windows overlap, and the canvas map sits over the dock's end at 1280x800:
 * a pointer click can land on what is on top (chromedriver refuses it as intercepted). The element's
 * own click reaches the button wherever it is drawn.
 */
export async function press(selector: string): Promise<void> {
  await $(selector).waitForExist();
  await browser.execute((s: string) => {
    (document.querySelector(s) as HTMLElement | null)?.click();
  }, selector);
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

/** The app's data folder under the spec's HOME (apps/desk/shell/src/paths.rs names it). */
export function appData(): string {
  const home = process.env[HOME_VAR];
  if (!home) throw new Error(`${HOME_VAR} is not set: run the specs through just test-app-e2e`);
  return dataDir(home);
}

/** A JSON file in the app's data folder, or undefined. */
export function dataFile(name: string): unknown {
  const folder = appData();
  try {
    return JSON.parse(readFileSync(join(folder, name), "utf8"));
  } catch {
    return undefined;
  }
}

/** Write a JSON file in the app's data folder, as if the app had left it so. */
export function writeDataFile(name: string, value: unknown): void {
  writeFileSync(join(appData(), name), JSON.stringify(value));
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
