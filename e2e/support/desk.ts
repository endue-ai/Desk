// What the specs share: the desk's status line, plugin frames, and the files the app keeps in its
// data folder under the spec's HOME (support/driver.ts sets it up).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { $, browser, expect } from "@wdio/globals";
import { HOME_VAR, LOG_VAR } from "./driver";

/** The status line the runtime shows and `desk_ready` prints once the bridge answered. */
export const READY = "desk ready · bridge: tauri";

/** A surface on the desk, by plugin id. */
export const surface = (plugin: string) => $(`[data-surface="${plugin}"]`);

/** Wait until the desk's status line reads READY (not "desk cannot reach the core ..."). */
export async function deskReady(): Promise<void> {
  await expect($("footer.desk-status")).toHaveElementProperty("textContent", READY, {
    wait: 30_000,
  });
}

/** Run `body` inside a plugin's sandboxed frame, then return to the desk. */
export async function inFrame<T>(plugin: string, body: () => Promise<T>): Promise<T> {
  const frame = $(`[data-surface="${plugin}"] iframe`);
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
