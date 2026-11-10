/**
 * A window's gestures when a host runs them (the CEF shell's compositor, ADR 0153): the title bar
 * and the eight grips keep their handles, cursors and the drag's lifecycle here (no text selected,
 * the click after a drag swallowed), and an accepted press tells the host what it starts. The host
 * moves, resizes and snaps the window on its own input, draws the preview and the glide, and
 * publishes where the window ends up (`shell/wm-host.ts`); nothing here moves it.
 */
import type { SurfacePlacement } from "../modes/types";
import type { ShellCtx } from "../shell/context";
import { h } from "../shell/dom";
import { draggable } from "../shell/drag";
import type { WindowManagerHost } from "../shell/wm-host";
import { RESIZE_DIRECTIONS, resizeCursor } from "./resize";

const nothing = () => undefined;

export function hostGestures(
  el: HTMLElement,
  bar: HTMLElement,
  placement: () => SurfacePlacement,
  ctx: ShellCtx,
  host: WindowManagerHost,
): () => void {
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
