/**
 * Where a window is and how big, in CSS pixels, for agents (ADR 0269): desk.windows.move puts a
 * window at a point or moves it by some pixels, desk.windows.resize gives it a size or grows it,
 * and desk.windows.fill maximizes it, snaps it to a half or a quarter (ADR 0128, ADR 0132) or
 * brings it back from a fill. The window manager runs each as it runs the keys' window commands
 * (crates/desk-wm `Wm::run`: its smallest size, a plugin's fixed size, the title bar in reach, a
 * floating window on screen), and each answers where the window ended up (`target.ts`).
 */
import type { SurfacePlacement } from "../modes/types";
import { type Ctx, edit } from "../shell/actions";
import type { Fill } from "../wm/types";
import {
  type Args,
  argsOf,
  drawnRect,
  FRAME,
  failed,
  frameOf,
  runOn,
  sayOf,
  WINDOW_ARG,
  windowInFront,
} from "./target";

export const MOVE = "desk.windows.move";
export const RESIZE = "desk.windows.resize";
export const FILL = "desk.windows.fill";

const FILLS: readonly Fill[] = [
  "full",
  "left",
  "right",
  "top",
  "bottom",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
];

const px = (description: string) => ({ type: "number", description });

const MOVE_ARGS = {
  type: "object",
  properties: {
    window: WINDOW_ARG,
    x: px("Where its left edge goes, in CSS pixels from the desk's left."),
    y: px("Where its top edge goes, in CSS pixels from the desk's top."),
    dx: px("Or how far it moves right, in CSS pixels (negative: left)."),
    dy: px("Or how far it moves down, in CSS pixels (negative: up)."),
  },
  additionalProperties: false,
};

const RESIZE_ARGS = {
  type: "object",
  properties: {
    window: WINDOW_ARG,
    w: px("Its width, in CSS pixels."),
    h: px("Its height, in CSS pixels."),
    dw: px("Or how much wider it gets, in CSS pixels (negative: narrower)."),
    dh: px("Or how much taller it gets, in CSS pixels (negative: shorter)."),
  },
  additionalProperties: false,
};

const FILL_ARGS = {
  type: "object",
  properties: {
    window: WINDOW_ARG,
    fill: {
      type: "string",
      enum: [...FILLS, "none"],
      description:
        "full: maximize; an edge's half or a corner's quarter: snap; none: back from a fill to where it was before, in the mode it had.",
    },
  },
  required: ["fill"],
  additionalProperties: false,
};

/** How far one axis moves: to `to` from `now`, or `by`; one of them, never both. */
function stepOf(args: Args, to: string, by: string, now: number): number | undefined {
  const [a, b] = [args[to], args[by]];
  if (a !== undefined && b !== undefined) throw failed(`${to} or ${by}, not both`);
  const given = a ?? b;
  if (given === undefined) return undefined;
  if (typeof given !== "number" || !Number.isFinite(given)) throw failed(`${to} is a number`);
  return a !== undefined ? given - now : given;
}

/** Window `p` out of its fill, back where it was before and in the mode it had (desk-wm `unfilled`). */
async function unfill(ctx: Ctx, p: SurfacePlacement): Promise<void> {
  const back = p.restore;
  // A fill saved without its place to come back to ends where it is, as a move ends one.
  if (!back) return runOn(ctx, { op: "move", dx: 0, dy: 0 }, p.id);
  const floating = back.floating ?? p.floating === true;
  await edit(ctx, {
    op: "set-geometry",
    geometry: {
      id: p.id,
      x: back.x,
      y: back.y,
      w: back.w,
      h: back.h,
      ...(floating && { floating }),
    },
  });
}

export function defineFrameCommands(ctx: Ctx): () => void {
  const { commands } = ctx.runtime;
  const say = sayOf(ctx);
  const offs = [
    commands.define(MOVE, {
      title: () => say("move"),
      keywords: ["move", "position", "place", "pixels", "window", "이동", "옮기기", "위치", "창"],
      owner: "desk",
      run: async (args) => {
        const a = argsOf(args);
        const p = windowInFront(ctx, a);
        const now = drawnRect(ctx, p);
        const dx = stepOf(a, "x", "dx", now.x);
        const dy = stepOf(a, "y", "dy", now.y);
        if (dx === undefined && dy === undefined) throw failed("say where: x, y, dx or dy");
        if (dx || dy) await runOn(ctx, { op: "move", dx: dx ?? 0, dy: dy ?? 0 }, p.id);
        return frameOf(ctx, p.id);
      },
      agent: {
        description:
          "Move a window of the current desktop, in CSS pixels in the space desk.windows.list answers (from the desk's top left): to x, y, or by dx, dy; give either axis alone to keep the other. Its size stays. A snapped or filled window leaves its fill where it is moved. The desk keeps its title bar within reach and a floating window on screen, so it answers where the window ended up. A window on another desktop is brought in front with desk.windows.focus first.",
        args: MOVE_ARGS,
        result: FRAME,
      },
    }),
    commands.define(RESIZE, {
      title: () => say("resize"),
      keywords: ["resize", "size", "width", "height", "pixels", "window", "크기", "창"],
      owner: "desk",
      run: async (args) => {
        const a = argsOf(args);
        const p = windowInFront(ctx, a);
        const now = drawnRect(ctx, p);
        const dw = stepOf(a, "w", "dw", now.w);
        const dh = stepOf(a, "h", "dh", now.h);
        if (dw === undefined && dh === undefined) throw failed("say how big: w, h, dw or dh");
        if (dw || dh) await runOn(ctx, { op: "resize", dw: dw ?? 0, dh: dh ?? 0 }, p.id);
        return frameOf(ctx, p.id);
      },
      agent: {
        description:
          "Resize a window of the current desktop, in CSS pixels: to w, h, or by dw, dh; give either alone to keep the other. Its top left corner stays where it is (move it too for another one). A snapped or filled window leaves its fill. The desk keeps a window at least as large as its panes need, keeps the size of a plugin's window that has a fixed size, and keeps a floating window on screen, so it answers the size the window ended up at.",
        args: RESIZE_ARGS,
        result: FRAME,
      },
    }),
    commands.define(FILL, {
      title: () => say("fill"),
      keywords: [
        "maximize",
        "snap",
        "fill",
        "half",
        "quarter",
        "restore",
        "window",
        "최대화",
        "복원",
        "절반",
        "창",
      ],
      owner: "desk",
      run: async (args) => {
        const a = argsOf(args);
        const p = windowInFront(ctx, a);
        const fill = a.fill;
        if (fill === "none") {
          if (p.fill) await unfill(ctx, p);
        } else if (FILLS.includes(fill as Fill)) {
          if (p.fill !== fill) await runOn(ctx, { op: "snap", fill: fill as Fill }, p.id);
        } else {
          throw failed(`fill is one of ${[...FILLS, "none"].join(", ")}`);
        }
        return frameOf(ctx, p.id);
      },
      agent: {
        description:
          "Maximize a window of the current desktop to the whole app (full), snap it to an edge's half (left, right, top, bottom) or a corner's quarter (top-left, top-right, bottom-left, bottom-right), or bring it back from any of those to the place and size it had before (none: restore). A window already so stays; a snapped or filled window floats above the canvas and keeps its part when the app is resized.",
        args: FILL_ARGS,
        result: FRAME,
      },
    }),
  ];
  return () => {
    for (const off of offs) off();
  };
}
