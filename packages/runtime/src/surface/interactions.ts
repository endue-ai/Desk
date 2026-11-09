import type { SurfacePlacement } from "../modes/types";
import { moveSurface } from "../shell/actions";
import type { ShellCtx } from "../shell/context";
import { h } from "../shell/dom";
import { draggable } from "../shell/drag";
import { panOf } from "../shell/Pan";
import { snapRect, snapTo, unfilled } from "../shell/windows";
import { isFloating, screenRect, storedRect } from "./coordinates";
import { clampRect, type Rect, screenArea } from "./geometry";
import { RESIZE_DIRECTIONS, resizeCursor, resizeRect } from "./resize";
import { aimSnap, type Snap } from "./snap";

export function place(el: HTMLElement, r: Rect): void {
  el.style.left = `${r.x}px`;
  el.style.top = `${r.y}px`;
  el.style.width = `${r.w}px`;
  el.style.height = `${r.h}px`;
}

/** The rect a drop will snap to, under the window being dragged, while the pointer aims at it. */
function snapPreview(el: HTMLElement, rectOf: (snap: Snap) => Rect) {
  let shown: HTMLElement | null = null;
  const hide = () => {
    shown?.remove();
    shown = null;
  };
  return {
    hide,
    show(snap: Snap | null) {
      if (!snap) return hide();
      shown ??= h("div", { class: "surface-snap", "aria-hidden": "true" });
      shown.dataset.snap = snap;
      shown.style.zIndex = el.style.zIndex;
      place(shown, rectOf(snap));
      if (shown.nextElementSibling !== el) el.parentElement?.insertBefore(shown, el);
    },
  };
}

/**
 * One pointer lifecycle for moving and all eight resize handles. A floating window moves and grows
 * over the whole app, under the bars. Dragging a window to an edge or a corner snaps it (ADR 0128),
 * a preview showing where while the pointer is there; dragging a filled one away brings back its
 * own size and mode, and resizing one ends the fill where it is.
 */
export function surfaceInteractions(
  el: HTMLElement,
  bar: HTMLElement,
  placement: () => SurfacePlacement,
  size: () => { vw: number; vh: number },
  ctx: ShellCtx,
): () => void {
  let start: Rect = { x: 0, y: 0, w: 0, h: 0 };
  /** The window as a move drops it off its fill: its own size and mode. Null for one not filled. */
  let own: SurfacePlacement | null = null;
  let aim: (pointer: { x: number; y: number }, area: Rect) => Snap | null = () => null;
  const preview = snapPreview(el, (snap) => snapRect(ctx, snap, size()));
  const begin = () => {
    start = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
    own = null;
    el.classList.add("is-dragging");
  };
  const beginMove = (down: PointerEvent) => {
    begin();
    const { vw, vh } = size();
    const p = placement();
    aim = aimSnap({ x: down.clientX, y: down.clientY }, screenArea(vw, vh));
    if (!p.restore) return;
    // A filled window comes off its fill as the drag starts: its own size again, the pointer at the
    // same share of its width, so the title bar stays under it.
    own = unfilled(p);
    const back = screenRect(own, panOf(ctx.store.get()), vw, vh);
    const share = start.w > 0 ? (down.clientX - start.x) / start.w : 0;
    start = { x: Math.round(down.clientX - share * back.w), y: start.y, w: back.w, h: back.h };
  };
  const floats = () => isFloating(own ?? placement());
  const commit = (r: Rect) => {
    el.classList.remove("is-dragging");
    const { vw, vh } = size();
    const floating = floats();
    moveSurface(ctx, placement().id, {
      ...storedRect(r, floating, panOf(ctx.store.get()), vw, vh),
      floating: floating || undefined,
      restore: undefined,
      fill: undefined,
    });
  };
  const cancel = () => {
    preview.hide();
    el.classList.remove("is-dragging");
    const { vw, vh } = size();
    place(el, screenRect(placement(), panOf(ctx.store.get()), vw, vh));
  };
  const moved = (dx: number, dy: number) => {
    const { vw, vh } = size();
    const r = { ...start, x: start.x + dx, y: start.y + dy };
    return floats() ? clampRect(r, vw, vh) : r;
  };
  const aimed = (e: PointerEvent) => {
    const { vw, vh } = size();
    return aim({ x: e.clientX, y: e.clientY }, screenArea(vw, vh));
  };
  const off = [
    draggable(bar, {
      // Shift + drag on a title bar pans the canvas instead (Pan.ts).
      accept: (e) => !e.shiftKey && !(e.target as Element).closest("button") && !placement().pinned,
      start: beginMove,
      cancel,
      move: (dx, dy, e) => {
        place(el, moved(dx, dy));
        preview.show(aimed(e));
      },
      end: (dx, dy, e) => {
        preview.hide();
        const snap = aimed(e);
        if (!snap) commit(moved(dx, dy));
        else {
          el.classList.remove("is-dragging");
          snapTo(ctx, placement().id, snap);
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
    preview.hide();
    for (const dispose of off) dispose();
  };
}
