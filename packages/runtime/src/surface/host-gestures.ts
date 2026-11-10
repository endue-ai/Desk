/**
 * A window's gestures: the window manager runs them (crates/desk-wm on the compositor's input, ADR
 * 0153). The title bar and the eight grips keep their handles, cursors and the drag's lifecycle
 * here (no text selected, the click after a drag swallowed), and an accepted press tells the window
 * manager what it starts. It moves, resizes and snaps the window on its own input, draws the preview
 * and the glide, and publishes where the window ends up (`shell/wm-host.ts`); nothing here moves it.
 * The runtime's own drag, resize, snap preview and glide went with the windowed desk (#83).
 */
import type { SurfacePlacement } from "../modes/types";
import type { ShellCtx } from "../shell/context";
import { h } from "../shell/dom";
import { draggable } from "../shell/drag";
import { RESIZE_DIRECTIONS, resizeCursor } from "./resize";

const nothing = () => undefined;

export function hostGestures(
  el: HTMLElement,
  bar: HTMLElement,
  placement: () => SurfacePlacement,
  ctx: Pick<ShellCtx, "wm" | "tr">,
): () => void {
  const host = ctx.wm;
  const at = (e: PointerEvent) => ({ x: e.clientX, y: e.clientY });
  const off = [
    draggable(bar, {
      // Shift + drag on a title bar pans the canvas instead (Pan.ts).
      accept: (e) => !e.shiftKey && !(e.target as Element).closest("button") && !placement().pinned,
      press: (e) => host.grab({ kind: "move", window: placement().id }, at(e)),
      move: nothing,
      end: nothing,
    }),
  ];
  for (const direction of RESIZE_DIRECTIONS) {
    const grip = h("span", {
      class: "surface-resize",
      "data-resize": direction,
      "aria-hidden": "true",
      title: ctx.tr("resize"),
    });
    el.append(grip);
    off.push(
      draggable(grip, {
        cursor: resizeCursor(direction),
        press: (e) => host.grab({ kind: "resize", window: placement().id, grip: direction }, at(e)),
        move: nothing,
        end: nothing,
      }),
    );
  }
  return () => {
    for (const dispose of off) dispose();
  };
}
