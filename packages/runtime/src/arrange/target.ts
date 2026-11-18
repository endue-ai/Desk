/**
 * Which window an agent's window command acts on, and where that window is after it (ADR 0269).
 * The window named, or the one in use; on the desktop in front, since the window manager moves
 * only those (crates/desk-wm `Wm::run`). Where it is comes from the desk the window manager
 * published last, in the space desk.windows.list answers: whole CSS pixels from the desk's top
 * left, halves up.
 */
import { CommandError } from "../commands";
import type { SurfacePlacement } from "../modes/types";
import { type Ctx, desktopId, desktopsOf, edit, windowsOf } from "../shell/actions";
import type { DeskState } from "../shell/state";
import { outWindows } from "../surface/placed";
import type { WindowOp } from "../wm/host";
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
}

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
