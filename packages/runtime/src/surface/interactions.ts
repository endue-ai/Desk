import type { SurfacePlacement } from "../modes/types";
import { moveSurface } from "../shell/actions";
import type { ShellCtx } from "../shell/context";
import { h } from "../shell/dom";
import { draggable } from "../shell/drag";
import { panOf } from "../shell/Pan";
import { snapTo } from "../shell/windows";
import { isFloating, screenRect, storedRect } from "./coordinates";
import { clampRect, type Rect, screenArea } from "./geometry";
import { RESIZE_DIRECTIONS, resizeCursor, resizeRect } from "./resize";
import { snapFor } from "./snap";

export function place(el: HTMLElement, r: Rect): void {
  el.style.left = `${r.x}px`;
  el.style.top = `${r.y}px`;
  el.style.width = `${r.w}px`;
  el.style.height = `${r.h}px`;
}

/**
 * One pointer lifecycle for moving and all eight resize handles. A floating window moves and grows
 * over the whole app, under the bars; moving or resizing a filled one ends the fill.
 */
export function surfaceInteractions(
  el: HTMLElement,
  bar: HTMLElement,
  placement: () => SurfacePlacement,
  size: () => { vw: number; vh: number },
  ctx: ShellCtx,
): () => void {
  let start: Rect = { x: 0, y: 0, w: 0, h: 0 };
  const begin = () => {
    start = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
    el.classList.add("is-dragging");
  };
  const commit = (r: Rect) => {
    el.classList.remove("is-dragging");
    const { vw, vh } = size();
    const p = placement();
    moveSurface(ctx, p.id, {
      ...storedRect(r, isFloating(p), panOf(ctx.store.get()), vw, vh),
      restore: undefined,
      fill: undefined,
    });
  };
  const cancel = () => {
    el.classList.remove("is-dragging");
    const { vw, vh } = size();
    place(el, screenRect(placement(), panOf(ctx.store.get()), vw, vh));
  };
  const moved = (dx: number, dy: number) => {
    const { vw, vh } = size();
    const r = { ...start, x: start.x + dx, y: start.y + dy };
    return isFloating(placement()) ? clampRect(r, vw, vh) : r;
  };
  const off = [
    draggable(bar, {
      // Shift + drag on a title bar pans the canvas instead (Pan.ts).
      accept: (e) => !e.shiftKey && !(e.target as Element).closest("button") && !placement().pinned,
      start: begin,
      cancel,
      move: (dx, dy) => place(el, moved(dx, dy)),
      end: (dx, dy, e) => {
        const { vw, vh } = size();
        const fill = snapFor({ x: e.clientX, y: e.clientY }, screenArea(vw, vh));
        if (!fill) commit(moved(dx, dy));
        else {
          el.classList.remove("is-dragging");
          snapTo(ctx, placement().id, fill);
        }
      },
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
    const resized = (dx: number, dy: number) => {
      const { vw, vh } = size();
      const bounds = isFloating(placement()) ? screenArea(vw, vh) : undefined;
      return resizeRect(start, direction, dx, dy, bounds);
    };
    off.push(
      draggable(grip, {
        cursor: resizeCursor(direction),
        start: begin,
        cancel,
        move: (dx, dy) => place(el, resized(dx, dy)),
        end: (dx, dy) => commit(resized(dx, dy)),
      }),
    );
  }
  return () => {
    for (const dispose of off) dispose();
  };
}
