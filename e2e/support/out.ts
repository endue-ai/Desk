// The windows out of the canvas as the windows-out spec reads them (#235, ADR 0205): the OS windows
// the shell holds, through its development command `compositor_window { app }`
// (`apps/desk/shell/src/app_windows/check.rs`). The machine running the specs may have its screen
// locked, where no pointer reaches an OS window: the command hands one the OS's close request, as
// its red button does, and moves it as a drag of its title bar and a resize would.
import { browser } from "@wdio/globals";
import { shellCommand } from "./compositor";
import { type Window, windowUntil } from "./windows";

/** A frame on the displays, in points, as the shell keeps it. */
export type Frame = { x: number; y: number; width: number; height: number };

/** One OS window the shell holds for a window out of the canvas. */
export interface AppWindow {
  window: string;
  plugin: string;
  surface: string;
  title: string;
  /** Absent while it is minimized, hidden or in full screen. */
  frame: Frame | null;
  /** Whether its browser opened. */
  browser: boolean;
}

const check = async (args: Record<string, unknown>) =>
  (await shellCommand<{ windows: AppWindow[] }>("compositor_window", args)).windows;

/** The OS windows the shell holds now, by window id. */
export const appWindows = () => check({ app: true });

/** Window `id`'s OS window, if it has one. */
export const appWindow = async (id: string) => (await appWindows()).find((w) => w.window === id);

/** Poll until window `id` has an OS window (`open`) or none. */
export async function appWindowUntil(id: string, open = true): Promise<AppWindow | undefined> {
  let last: AppWindow | undefined;
  await browser.waitUntil(
    async () => {
      last = await appWindow(id);
      return open ? last?.browser === true && last.frame !== null : last === undefined;
    },
    { timeout: 15_000, timeoutMsg: `${id} has ${open ? "no OS window" : "an OS window still"}` },
  );
  return last;
}

/** Press the red button of window `id`'s OS window. */
export const closeAppWindow = (id: string) => check({ app: id, close: true });

/** Move window `id`'s OS window to `frame` and resize it, then wait until the desk lists it there. */
export async function moveAppWindow(id: string, frame: Frame): Promise<Window> {
  await check({ app: id, frame });
  return windowUntil(id, (w) => isAt(w, frame), `listed out at ${JSON.stringify(frame)}`);
}

/** Whether the desk lists window `w` out of the canvas at `frame`. */
export const isAt = (w: Window, frame: Frame) =>
  w.out !== undefined &&
  (["x", "y", "w", "h"] as const).every((k) => w.out?.[k] === outOf(frame)[k]);

/** A frame as desk.windows.list names it (`out`). */
export const outOf = (f: Frame) => ({ x: f.x, y: f.y, w: f.width, h: f.height });
