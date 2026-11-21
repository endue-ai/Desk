/**
 * Which window an agent's window command acts on, and where that window is after it (ADR 0269).
 * The window named, or the one in use; on the desktop in front, since the window manager moves
 * only those (crates/desk-wm `Wm::run`). Where it is comes from the desk the window manager
 * published last, in the space desk.windows.list answers: whole CSS pixels from the desk's top
 * left, halves up. A window popped out into an OS window of its own (issue 235) is moved, sized,
 * filled and pinned in that OS window, in points of the OS's screens (ADR 0294).
 */
import { CommandError } from "../commands";
import type { SurfacePlacement } from "../modes/types";
import { type Ctx, desktopId, desktopsOf, edit, windowsOf } from "../shell/actions";
import type { DeskState } from "../shell/state";
import { outWindows } from "../surface/placed";
import type { OutAsk, OutFrame, WindowOp } from "../wm/host";
import type { Fill, Rect } from "../wm/types";
import { rectIn } from "../wm/view";
import { type ArrangeCopyKey, arrangeText } from "./copy";

/** The `window` arg every one of these commands takes. */
export const WINDOW_ARG = {
  type: "string",
  minLength: 1,
  maxLength: 128,
  description: "The window, by id as desk.windows.list names it; the window in use when left out.",
};

/** How a window is placed, as desk.windows.list says it (`BrainDeskWindowState`). */
export type FrameState = "normal" | "floating" | "snapped" | "filled";

/** Where a window is after a command, and how it is placed. */
export interface Frame {
  window: string;
  desktop: string;
  x: number;
  y: number;
  w: number;
  h: number;
  state: FrameState;
  fill?: Fill;
  floating: boolean;
  pinned: boolean;
  /** In an OS window of its own (ADR 0294): x, y, w, h are that window's frame, in points. */
  out?: boolean;
  /** Then the work area of the display it is on, in points. */
  screen?: Rect;
}

const RECT = {
  type: "object",
  properties: {
    x: { type: "number" },
    y: { type: "number" },
    w: { type: "number" },
    h: { type: "number" },
  },
  required: ["x", "y", "w", "h"],
};

/** What every one of these commands answers: `Frame` as JSON Schema. */
export const FRAME = {
  type: "object",
  description: "Where the window is now, in whole CSS pixels from the desk's top left.",
  properties: {
    window: { type: "string" },
    desktop: { type: "string", description: "The desktop it is on, by id." },
    x: { type: "integer" },
    y: { type: "integer" },
    w: { type: "integer", minimum: 0 },
    h: { type: "integer", minimum: 0 },
    state: { type: "string", enum: ["normal", "floating", "snapped", "filled"] },
    fill: {
      type: "string",
      enum: [
        "full",
        "left",
        "right",
        "top",
        "bottom",
        "top-left",
        "top-right",
        "bottom-left",
        "bottom-right",
      ],
    },
    floating: { type: "boolean" },
    pinned: { type: "boolean" },
    out: {
      type: "boolean",
      description:
        "True for a window popped out into an OS window of its own: then x, y, w, h are that OS window's frame in points of the OS's screens (from the main display's top left), not CSS pixels of the desk.",
    },
    screen: {
      ...RECT,
      description: "For a window out: the work area of the display its OS window is on, in points.",
    },
  },
  required: ["window", "desktop", "x", "y", "w", "h", "state", "floating", "pinned"],
};

export type Args = Record<string, unknown>;

export const argsOf = (args: unknown): Args =>
  typeof args === "object" && args !== null ? (args as Args) : {};

export const failed = (message: string) => new CommandError("failed", message);

export function sayOf(ctx: Pick<Ctx, "store">) {
  return (key: ArrangeCopyKey, vars?: Record<string, string | number>) =>
    arrangeText(ctx.store.get().lang, key, vars);
}

/** The window `args` names, else the one in use: refused unless it is on the desktop in front. */
export function windowInFront(ctx: Pick<Ctx, "store">, args: Args): SurfacePlacement {
  const say = sayOf(ctx);
  const s = ctx.store.get();
  const given = args.window;
  if (given !== undefined && typeof given !== "string") throw failed("window is a window's id");
  const id = given ?? s.focused;
  if (!id) throw failed(say("noWindow"));
  const here = windowsOf(s).find((p) => p.id === id);
  if (here) return here;
  if (outWindows(s).some((p) => p.id === id)) throw failed(say("isOut"));
  const there = desktopsOf(s).find((d) => windowsOf(s, d.id).some((p) => p.id === id));
  if (there) throw failed(say("onOther", { desktop: there.name }));
  throw failed(say("notHere"));
}

/** What a command acts on: a window of the desktop in front, or one out in an OS window. */
export type Target = { out: false; p: SurfacePlacement } | { out: true; p: SurfacePlacement };

/**
 * The window `args` names, else the one in use: one of the desktop in front, or one popped out of
 * the canvas into an OS window (ADR 0294), whatever desktop it docks back to.
 */
export function windowTarget(ctx: Pick<Ctx, "store">, args: Args): Target {
  const s = ctx.store.get();
  const id = typeof args.window === "string" ? args.window : s.focused;
  const out = id ? outWindows(s).find((p) => p.id === id) : undefined;
  return out ? { out: true, p: out } : { out: false, p: windowInFront(ctx, args) };
}

/** The desktop out window `id` docks back to. */
function outDesktop(s: DeskState, id: string): string {
  const docks = Object.entries(s.wm.layouts).find(([, l]) => l.surfaces.some((p) => p.id === id));
  return docks?.[0] ?? String(desktopId(s));
}

/** Ask the OS window of out window `id` for `ask`; refused on a desk that has no OS windows. */
export function runOut(ctx: Pick<Ctx, "store" | "wm">, id: string, ask: OutAsk): Promise<OutFrame> {
  if (!ctx.wm.outWindow) return Promise.reject(failed(sayOf(ctx)("noOs")));
  return ctx.wm.outWindow(id, ask);
}

/** Where out window `p` is, its OS window at `f`, as these commands answer it. */
export function outFrameOf(ctx: Pick<Ctx, "store">, p: SurfacePlacement, f: OutFrame): Frame {
  const state: FrameState = f.fill === "full" ? "filled" : f.fill ? "snapped" : "normal";
  return {
    window: p.id,
    desktop: outDesktop(ctx.store.get(), p.id),
    x: whole(f.x),
    y: whole(f.y),
    w: whole(f.w),
    h: whole(f.h),
    state,
    ...(f.fill ? { fill: f.fill } : {}),
    floating: false,
    pinned: f.pinned,
    out: true,
    screen: f.screen,
  };
}

/** Where window `p` of the desktop in front is drawn now, unrounded. */
export function drawnRect(ctx: Pick<Ctx, "store">, p: SurfacePlacement): Rect {
  return rectIn(ctx.store.get().wm, p.id) ?? { x: p.x, y: p.y, w: p.w, h: p.h };
}

/** A whole pixel, halves up, and never -0. */
const whole = (n: number) => Math.floor(n + 0.5) + 0;

/** Where window `id` is now and how it is placed, as desk.windows.list would say it. */
export function frameOf(ctx: Pick<Ctx, "store">, id: string): Frame {
  const s = ctx.store.get();
  const desktop = desktopsOf(s).find((d) => windowsOf(s, d.id).some((p) => p.id === id));
  const on = desktop?.id ?? desktopId(s);
  const p = windowsOf(s, on).find((w) => w.id === id);
  if (!p) throw failed(sayOf(ctx)("notHere"));
  const r = rectIn(s.wm, id, on) ?? { x: p.x, y: p.y, w: p.w, h: p.h };
  const floating = p.floating === true || p.fill !== undefined;
  const state: FrameState =
    p.fill === "full" ? "filled" : p.fill ? "snapped" : floating ? "floating" : "normal";
  return {
    window: id,
    desktop: String(on),
    x: whole(r.x),
    y: whole(r.y),
    w: whole(r.w),
    h: whole(r.h),
    state,
    ...(p.fill ? { fill: p.fill } : {}),
    floating,
    pinned: p.pinned === true,
  };
}

/** How long a command waits past its batch for the desk it made before it answers anyway. */
export const LATE_MS = 400;

/** What a window command can change of window `id`: where it is drawn and how it is placed. */
const shapeOf = (s: DeskState, id: string) => {
  const p = windowsOf(s).find((w) => w.id === id);
  return [rectIn(s.wm, id), p?.fill, p?.floating, p?.restore, p?.pinned];
};

/**
 * Run window command `op` on window `id` and wait for the desk it made (#83). A host runs a command
 * after the edits asked before it, so the desk it made is usually in once an empty batch asked next
 * settles; the app's shell takes each page call on a thread of its own, though, so that batch can
 * overtake it (`apps/desk/src/compositor-wm.ts`). Until the window changes, then, it waits a little
 * longer: a command that changed nothing (the window held by a gesture, already at its edge) answers
 * after LATE_MS.
 */
export async function runOn(
  ctx: Pick<Ctx, "wm" | "store">,
  op: WindowOp,
  id: string,
): Promise<void> {
  const before = JSON.stringify(shapeOf(ctx.store.get(), id));
  let changed = () => {};
  const done = new Promise<void>((resolve) => {
    changed = resolve;
  });
  const off = ctx.store.watch(
    (s) => shapeOf(s, id),
    (now) => JSON.stringify(now) !== before && changed(),
  );
  try {
    ctx.wm.run(op, id);
    await edit(ctx);
    if (JSON.stringify(shapeOf(ctx.store.get(), id)) === before) {
      await Promise.race([done, new Promise((late) => setTimeout(late, LATE_MS))]);
    }
  } finally {
    off();
  }
}
