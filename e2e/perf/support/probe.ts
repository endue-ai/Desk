// Input to screen, measured in the shell page: lib/probe.ts holds the page side and says what is
// timed. Each press takes the keyboard for the shell page, arms the probe, presses the keys, waits
// for what the probe saw and undoes the change; a press that went through a frame is pressed again.
import { browser } from "@wdio/globals";
import {
  armProbe,
  type Change,
  type Probe,
  paletteShown as palette,
  pressUntilTimed,
  readProbe,
  takeKeyboard,
} from "../lib/probe";

export type { Change };

/** Press `keys` until the shell page times a press: its time, and the frames earlier ones went to. */
export function timed(change: Change, keys: string[], what: string, undo: () => Promise<void>) {
  return pressUntilTimed(async () => {
    const holder = await browser.execute(takeKeyboard);
    if (holder !== null) throw new Error(`${what}: the keyboard stays in ${holder}'s frame`);
    await browser.execute(armProbe, change);
    await browser.keys(keys);
    const probe = await seen(what);
    await undo();
    return probe;
  }, what);
}

/** What the armed probe saw: the key's time once its change was painted, or the frame it went to. */
async function seen(what: string): Promise<Probe> {
  let probe: Probe = {};
  await browser.waitUntil(
    async () => {
      probe = await browser.execute(readProbe);
      return typeof probe.ms === "number" || typeof probe.frame === "string";
    },
    { timeout: 5_000, interval: 20, timeoutMsg: `${what}: the change never showed` },
  );
  return probe;
}

/** Whether the palette's surface is shown. */
export function paletteShown(): Promise<boolean> {
  return browser.execute(palette);
}
