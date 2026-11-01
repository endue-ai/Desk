import type { SurfacePlacement } from "../modes/types";
import { moveSurface } from "../shell/actions";
import type { ShellCtx } from "../shell/context";
import { h } from "../shell/dom";
import { draggable } from "../shell/drag";
import { panOf } from "../shell/Pan";
import { isFloating, screenRect, storedRect } from "./coordinates";
import { clampRect, freeOnScreen, type Rect, SAFE } from "./geometry";
import { RESIZE_DIRECTIONS, resizeCursor, resizeRect } from "./resize";
import { snapFor } from "./snap";

export function place(el: HTMLElement, r: Rect): void {
  el.style.left = `${r.x}px`;
  el.style.top = `${r.y}px`;
  el.style.width = `${r.w}px`;
  el.style.height = `${r.h}px`;
}

/** One pointer lifecycle for moving and all eight resize handles. */
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
      accept: (e) => !(e.target as Element).closest("button") && !placement().pinned,
      start: begin,
      cancel,
      move: (dx, dy) => place(el, moved(dx, dy)),
      end: (dx, dy, e) => {
        const r = moved(dx, dy);
        const { vw, vh } = size();
        const snap = isFloating(placement())
          ? snapFor(r, { x: e.clientX, y: e.clientY }, freeOnScreen(vw, vh))
          : null;
        commit(snap ?? r);
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
      const bounds = isFloating(placement())
        ? {
            x: SAFE.left,
            y: SAFE.top,
            w: vw - SAFE.left - SAFE.right,
            h: vh - SAFE.top - SAFE.bottom,
          }
        : undefined;
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
