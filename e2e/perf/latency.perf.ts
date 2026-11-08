// Input latency on the Default profile (fresh data folder, no dev plugin): the palette from Mod+K
// (Control+K here) to its surface shown, and the surface focus switch (Control+Tab,
// desk.display.focus-next) to the focus moved, each the p95 of 20 tries after two warm-ups.
// lib/probe.ts times each one inside the shell page; a key that reached the desk through a plugin's
// frame instead is pressed again and listed in `throughFrames`. RT-16's 16 ms is printed beside,
// not a gate.
import { browser } from "@wdio/globals";
import { shellReady } from "../support/desk";
import { percentile, round1 } from "./lib/stats";
import { measured as save } from "./support/out";
import { type Change, paletteShown, timed } from "./support/probe";

const WARM_UP = 2;
const TRIES = 20;

async function tries(change: Change, keys: string[], undo: () => Promise<void>) {
  const times: number[] = [];
  const throughFrames: string[] = [];
  for (let n = 0; n < WARM_UP + TRIES; n++) {
    const press = await timed(change, keys, `${keys.join("+")} (try ${n + 1})`, undo);
    if (n >= WARM_UP) times.push(round1(press.ms));
    throughFrames.push(...press.throughFrames);
    await browser.pause(100);
  }
  return { times, throughFrames };
}

describe("input latency: the palette and the focus switch, p95 of 20", () => {
  it("measures both from the key to the frame that shows the change", async () => {
    await shellReady();
    const palette = await tries("palette", ["Control", "k"], async () => {
      await browser.keys("Escape");
      await browser.waitUntil(async () => !(await paletteShown()), {
        timeout: 5_000,
        timeoutMsg: "Escape did not close the palette",
      });
    });
    const focus = await tries("focus", ["Control", "Tab"], async () => {});
    save("latency", {
      inputLatency: {
        paletteP95Ms: percentile(palette.times, 0.95),
        focusP95Ms: percentile(focus.times, 0.95),
        tries: TRIES,
        palette: palette.times,
        focus: focus.times,
        throughFrames: { palette: palette.throughFrames, focus: focus.throughFrames },
      },
    });
  });
});
