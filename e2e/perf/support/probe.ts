// Input to screen, measured in the shell page: from a key's keydown (its `timeStamp`, when the page
// got the event) to the animation frame after the one in which the change was first seen, by when
// that change was painted. WebKitWebDriver delivers the keys; the OS's own input path before the
// page is not in the number.
import { browser } from "@wdio/globals";

/** What a key is expected to change: the palette's surface shown, or the focus moved. */
export type Change = "palette" | "focus";

type Probe = { ms?: number };

/** Get ready to time the next key that is not a bare modifier. */
export async function arm(change: Change): Promise<void> {
  await browser.execute((change: Change) => {
    const probe: Probe = {};
    (window as unknown as { __deskProbe: Probe }).__deskProbe = probe;
    const before = document.activeElement;
    const palette = () => {
      const section = document.querySelector<HTMLElement>(
        '.desk-surface[data-surface="desk.palette"]',
      );
      return section !== null && !section.hidden;
    };
    const changed = change === "palette" ? palette : () => document.activeElement !== before;
    const onKey = (event: KeyboardEvent) => {
      if (["Control", "Shift", "Alt", "Meta"].includes(event.key)) return;
      removeEventListener("keydown", onKey, true);
      const start = event.timeStamp;
      const watch = () => {
        if (!changed()) {
          requestAnimationFrame(watch);
          return;
        }
        requestAnimationFrame((painted) => {
          probe.ms = painted - start;
        });
      };
      requestAnimationFrame(watch);
    };
    addEventListener("keydown", onKey, true);
  }, change);
}

/** The armed key's time, once its change was painted. */
export async function measured(what: string): Promise<number> {
  let ms: number | undefined;
  await browser.waitUntil(
    async () => {
      ms = await browser.execute(
        () => (window as unknown as { __deskProbe?: Probe }).__deskProbe?.ms,
      );
      return typeof ms === "number";
    },
    { timeout: 5_000, interval: 20, timeoutMsg: `${what}: the change never showed` },
  );
  return ms as number;
}

/** Give the keyboard back to the shell page: a frame holding the focus lets it go. */
export async function focusShell(): Promise<void> {
  await browser.execute(() => {
    const active = document.activeElement;
    if (active instanceof HTMLIFrameElement) active.blur();
  });
}

/** Whether the palette's surface is shown. */
export function paletteShown(): Promise<boolean> {
  return browser.execute(() => {
    const section = document.querySelector<HTMLElement>(
      '.desk-surface[data-surface="desk.palette"]',
    );
    return section !== null && !section.hidden;
  });
}
