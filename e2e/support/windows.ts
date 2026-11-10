// The window manager as the windows-* specs read it (#82): desk.windows.list over the desk socket
// (desk.sock, ADR 0030), as the caller `cli`, which runs any desk command. The specs read windows
// only through it and act only through desk.* commands, the bridge and the person's input
// (gestures.ts), never through the page, so they hold when the compositor draws the windows
// (#53): today they run on the DOM window manager, later on desk-wm. Rects are whole CSS pixels of
// the desk; `z` ranks a desktop's windows from 0 at the back (specs/bridge/v0, BrainDesk).
import { browser } from "@wdio/globals";
import type {
  BrainDesk,
  BrainDeskDesktop,
  BrainDeskFill,
  BrainDeskWindow,
} from "../../packages/bridge/src/generated";
import { DeskSocket, socketPath } from "../perf/support/socket";
import { HOME_VAR } from "./driver";

export type Desk = BrainDesk;
export type Window = BrainDeskWindow;
export type Rect = { x: number; y: number; w: number; h: number };

let open: { socket: DeskSocket; gone: boolean } | undefined;

/** The desk's socket, connected again after a relaunch (the app binds it at start). */
async function socket(): Promise<DeskSocket> {
  if (open && !open.gone) return open.socket;
  const home = process.env[HOME_VAR];
  if (!home) throw new Error(`${HOME_VAR} is not set: run the specs through just test-app-e2e`);
  let last: unknown;
  for (let tries = 0; tries < 100; tries++) {
    try {
      const connected = await DeskSocket.connect(socketPath(home));
      const entry = { socket: connected, gone: false };
      void connected.closed.then(() => {
        entry.gone = true;
      });
      open = entry;
      return connected;
    } catch (error) {
      last = error;
      await browser.pause(100);
    }
  }
  throw new Error(`no desk answers on its socket: ${String(last)}`);
}

/** Run a desk command as `desk cmd run` does; its answer. */
export async function run(command: string, args?: Record<string, unknown>): Promise<unknown> {
  return (await socket()).run(command, args);
}

/** One bridge call as the caller `cli`. */
export async function call(method: string, params: unknown): Promise<unknown> {
  return (await socket()).call(method, params);
}

/** What desk.windows.list answers now. */
export const deskNow = () => run("desk.windows.list") as Promise<Desk>;

/** The desktop in front. */
export function front(desk: Desk): BrainDeskDesktop {
  const current = desk.desktops?.find((d) => d.current);
  if (!current) throw new Error("desk.windows.list names no desktop in front");
  return current;
}

/** How far the canvas of the desktop in front is panned. */
export const panOf = (desk: Desk) => front(desk).pan ?? { x: 0, y: 0 };

/** The windows on the desktop in front, front to back. */
export const onScreen = (desk: Desk) =>
  desk.windows.filter((w) => !w.hidden && w.desktop === front(desk).id);

export const rectOf = (w: Window): Rect => ({ x: w.x, y: w.y, w: w.w, h: w.h });

/** A window by id: the one on the desktop in front, else the first listed. */
export function byId(desk: Desk, id: string): Window | undefined {
  return onScreen(desk).find((w) => w.id === id) ?? desk.windows.find((w) => w.id === id);
}

/** Poll desk.windows.list until `test` holds; the message names the last answer when it never does. */
export async function until(
  test: (desk: Desk) => boolean,
  what: string,
  timeout = 10_000,
): Promise<Desk> {
  let last: Desk | undefined;
  try {
    await browser.waitUntil(
      async () => {
        last = await deskNow();
        return test(last);
      },
      { timeout, interval: 100 },
    );
  } catch (error) {
    const seen = last
      ? JSON.stringify({ desktops: last.desktops, windows: last.windows }).slice(0, 2400)
      : "nothing";
    throw new Error(`${what}; desk.windows.list last answered ${seen} (${String(error)})`);
  }
  if (!last) throw new Error(what);
  return last;
}

/** Window `id` once `test` holds for it. */
export async function windowUntil(
  id: string,
  test: (w: Window) => boolean,
  what: string,
): Promise<Window> {
  const desk = await until((d) => {
    const w = byId(d, id);
    return w !== undefined && test(w);
  }, `${id}: ${what}`);
  return byId(desk, id) as Window;
}

/** Window `id` as listed now; it must be there. */
export async function windowNow(id: string): Promise<Window> {
  const w = byId(await deskNow(), id);
  if (!w) throw new Error(`${id} is not on the desk`);
  return w;
}

/** The window in use on the desktop in front. */
export const inUse = (desk: Desk) => onScreen(desk).find((w) => w.focused);

/** The highest rank on the desktop in front: the window drawn on top. */
export const topZ = (desk: Desk) => Math.max(...onScreen(desk).map((w) => w.z ?? -1));

/** A new window with a launcher (desk.display.new-surface, ⌘N): its id, once it is in use. */
export async function openWindow(): Promise<string> {
  const before = new Set(onScreen(await deskNow()).map((w) => w.id));
  await run("desk.display.new-surface");
  const desk = await until((d) => {
    const w = inUse(d);
    return w !== undefined && !before.has(w.id);
  }, "a new window in use");
  return (inUse(desk) as Window).id;
}

/** A new, empty desktop in front (desk.shell.desktop-new): each case starts on one, unpanned. */
export async function freshDesktop(): Promise<string> {
  const was = front(await deskNow()).id;
  await run("desk.shell.desktop-new");
  const desk = await until((d) => front(d).id !== was, "a new desktop in front");
  return front(desk).id;
}

/** A window of the shell's own (a launcher, a view): none of its panes is a plugin's. */
const shellWindow = (w: Window) => !w.panes.some((p) => p.plugin);

/**
 * Close the shell's windows on the desktop in front, as the person does with ⌘W: the pane in use,
 * and the focus moved on (⌘]) when it is not in one of them. Each case ends with this, so the next
 * one's new windows start from `window-1` again and the desktops it leaves behind stay empty.
 */
export async function closeShellWindows(): Promise<void> {
  for (let step = 0; step < 40; step++) {
    const desk = await deskNow();
    const left = onScreen(desk).filter(shellWindow);
    if (left.length === 0) return;
    const using = inUse(desk);
    await run(using && shellWindow(using) ? "desk.display.close-pane" : "desk.display.focus-next");
  }
  throw new Error("the shell's windows did not close");
}

type Listed = { plugins: Array<{ id: string; enabled?: boolean }> };

/**
 * Turn off every plugin whose window the profile put on the desk but those in `keep`, through the
 * bridge (plugin.setEnabled, as `desk plugin disable` does), so a spec starts from an empty canvas as
 * the runtime e2e's fixture does. The data folder keeps it across a relaunch.
 */
export async function clearDesk(keep: string[] = []): Promise<void> {
  const scope = { permission: "plugin:manage" };
  const shown = new Set(
    (await deskNow()).windows.flatMap((w) => w.panes.flatMap((p) => (p.plugin ? [p.plugin] : []))),
  );
  const { plugins } = (await call("plugin.list", { scope })) as Listed;
  const off = plugins.filter((p) => p.enabled && shown.has(p.id) && !keep.includes(p.id));
  for (const p of off) await call("plugin.setEnabled", { plugin: p.id, enabled: false, scope });
  const gone = new Set(off.map((p) => p.id));
  await until(
    (d) => !d.windows.some((w) => w.panes.some((p) => p.plugin && gone.has(p.plugin))),
    "the plugins turned off left the desk",
    20_000,
  );
}

/** Between the two halves, or the four quarters, of the app (ADR 0128). */
const GAP = 12;

/** The part of a `w`×`h` app a snap or a fill takes (ADR 0128, ADR 0132). */
export function partOf(fill: BrainDeskFill, screen: { w: number; h: number }): Rect {
  const half = Math.floor((screen.w - GAP) / 2);
  const row = Math.floor((screen.h - GAP) / 2);
  const left = fill.includes("left");
  const right = fill.includes("right");
  const top = fill.includes("top");
  const bottom = fill.includes("bottom");
  return {
    x: right ? screen.w - half : 0,
    y: bottom ? row + GAP : 0,
    w: left || right ? half : screen.w,
    h: top || bottom ? row : screen.h,
  };
}
