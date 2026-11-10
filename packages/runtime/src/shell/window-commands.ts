/**
 * The window commands (desk.display.*): maximize and restore, the eight snaps (ADR 0128), and moving
 * and resizing the window in use by a step, for keys, the palette and agents. Each acts on the
 * focused window; nothing happens with none. A host that runs the window manager (the compositor,
 * ADR 0153) runs them there, and they come back as its changes; else the runtime's own does.
 */

import type { Fill } from "../surface/snap";
import type { ShellCtx } from "./context";
import type { CopyKey } from "./copy";
import { focusedWindow, moveBy, resizeBy, snapTo, toggleMaximize } from "./windows";
import type { WindowOp } from "./wm-host";

/** How far one step moves or resizes a window: the cascade's step. */
export const STEP = 32;

/** A command: its id under desk.display, its title, its words and what it does. */
type Spec = [string, CopyKey, string[], WindowOp];

const snap = (fill: Fill): WindowOp => ({ op: "snap", fill });

export const WINDOW_COMMANDS: Spec[] = [
  [
    "maximize",
    "cmdMaximize",
    ["maximize", "restore", "fill", "최대화", "복원"],
    { op: "maximize" },
  ],
  ["snap-left", "cmdSnapLeft", ["snap", "left", "half", "왼쪽", "절반"], snap("left")],
  ["snap-right", "cmdSnapRight", ["snap", "right", "half", "오른쪽", "절반"], snap("right")],
  ["snap-top", "cmdSnapTop", ["snap", "top", "half", "위쪽", "절반"], snap("top")],
  ["snap-bottom", "cmdSnapBottom", ["snap", "bottom", "half", "아래쪽", "절반"], snap("bottom")],
  ["snap-top-left", "cmdSnapTopLeft", ["snap", "quarter", "corner", "사분면"], snap("top-left")],
  ["snap-top-right", "cmdSnapTopRight", ["snap", "quarter", "corner", "사분면"], snap("top-right")],
  [
    "snap-bottom-left",
    "cmdSnapBottomLeft",
    ["snap", "quarter", "corner", "사분면"],
    snap("bottom-left"),
  ],
  [
    "snap-bottom-right",
    "cmdSnapBottomRight",
    ["snap", "quarter", "corner", "사분면"],
    snap("bottom-right"),
  ],
  ["move-left", "cmdMoveLeft", ["move", "left", "옮기기"], { op: "move", dx: -STEP, dy: 0 }],
  ["move-right", "cmdMoveRight", ["move", "right", "옮기기"], { op: "move", dx: STEP, dy: 0 }],
  ["move-up", "cmdMoveUp", ["move", "up", "옮기기"], { op: "move", dx: 0, dy: -STEP }],
  ["move-down", "cmdMoveDown", ["move", "down", "옮기기"], { op: "move", dx: 0, dy: STEP }],
  ["grow-width", "cmdGrowWidth", ["resize", "wider", "크기"], { op: "resize", dw: STEP, dh: 0 }],
  [
    "shrink-width",
    "cmdShrinkWidth",
    ["resize", "narrower", "크기"],
    { op: "resize", dw: -STEP, dh: 0 },
  ],
  ["grow-height", "cmdGrowHeight", ["resize", "taller", "크기"], { op: "resize", dw: 0, dh: STEP }],
  [
    "shrink-height",
    "cmdShrinkHeight",
    ["resize", "shorter", "크기"],
    { op: "resize", dw: 0, dh: -STEP },
  ],
];

/** Run `op` on window `id` with the runtime's own window manager. */
export function runWindowOp(ctx: ShellCtx, id: string, op: WindowOp): void {
  if (op.op === "maximize") toggleMaximize(ctx, id);
  else if (op.op === "snap") snapTo(ctx, id, op.fill);
  else if (op.op === "move") moveBy(ctx, id, op.dx, op.dy);
  else resizeBy(ctx, id, op.dw, op.dh);
}

/** Define the window commands through `display` (desk.display.<id>). */
export function defineWindowCommands(
  ctx: ShellCtx,
  display: (id: string, title: string, keywords: string[], run: () => unknown) => void,
): void {
  for (const [id, title, words, op] of WINDOW_COMMANDS) {
    display(id, ctx.tr(title), words, () => {
      const window = focusedWindow(ctx);
      if (!window) return;
      if (ctx.wm) ctx.wm.run(op, window);
      else runWindowOp(ctx, window, op);
    });
  }
}
