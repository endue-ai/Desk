// Rows that drag desk data, with a movement threshold (ADR 0119): a press becomes a drag only once
// the pointer has moved DRAG_THRESHOLD pixels, so a press that does not move stays a click. The
// browser's own drag (a draggable row, an image, a link) never starts for a row that drags this way:
// in WebKit it turned a click that moved a few pixels into a drag, and the click was lost.
import type { DraggableOptions, DragResult, DragStart, PointerLike } from "./dnd/types";

/** How far, in CSS pixels, the pointer moves before a press becomes a drag. */
export const DRAG_THRESHOLD = 6;
/** An options object, not `true`: Node's EventTarget (the tests) reads the two apart. */
const CAPTURE = { capture: true };

type StartDrag = (drag: DragStart) => Promise<DragResult>;
type Press = PointerLike & { button?: number; isPrimary?: boolean; pointerId?: number };

/**
 * Make the rows of `list` drag. `item(target)` says what a press on `target` drags (undefined: it
 * does not); `win` hears the pointer move (the list's window by default). Returns the function that
 * stops.
 */
export function draggable(
  list: EventTarget,
  options: DraggableOptions,
  startDrag: StartDrag,
  win: EventTarget = (list as Node).ownerDocument?.defaultView ?? list,
): () => void {
  const threshold = options.threshold ?? DRAG_THRESHOLD;
  let pressed: (() => void) | undefined;
  let unswallow: (() => void) | undefined;

  /** The click the release of a drag would send must not activate the row under it. */
  const swallowClick = () => {
    const swallow = (event: Event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      unswallow?.();
    };
    win.addEventListener("click", swallow, CAPTURE);
    const timer = setTimeout(() => unswallow?.(), 0);
    unswallow = () => {
      clearTimeout(timer);
      win.removeEventListener("click", swallow, CAPTURE);
      unswallow = undefined;
    };
  };

  const down = (event: Event) => {
    const press = event as Event & Press;
    if (pressed || (press.button ?? 0) !== 0 || press.isPrimary === false) return;
    const start = options.item(press.target ?? null);
    if (!start) return;
    unswallow?.();
    const x0 = press.clientX;
    const y0 = press.clientY;
    const id = press.pointerId;
    const mine = (e: Event) => id === undefined || (e as Event & Press).pointerId === id;
    const move = (e: Event) => {
      const at = e as Event & Press;
      if (!mine(e) || Math.hypot(at.clientX - x0, at.clientY - y0) < threshold) return;
      end();
      // From here the drag follows the pointer; its release must not click the row under it. A
      // release the desk heard instead (outside the frame) leaves no click to swallow.
      win.addEventListener("pointerup", swallowClick, { capture: true, once: true });
      void startDrag({ ...start, event: at }).then((result) => {
        win.removeEventListener("pointerup", swallowClick, CAPTURE);
        options.ended?.(result, start);
      });
    };
    const end = () => {
      win.removeEventListener("pointermove", move, CAPTURE);
      win.removeEventListener("pointerup", end, CAPTURE);
      win.removeEventListener("pointercancel", end, CAPTURE);
      pressed = undefined;
    };
    pressed = end;
    win.addEventListener("pointermove", move, CAPTURE);
    win.addEventListener("pointerup", end, CAPTURE);
    win.addEventListener("pointercancel", end, CAPTURE);
  };
  /** The browser's own drag never competes with a row that drags as desk data. */
  const native = (event: Event) => {
    if (options.item(event.target)) event.preventDefault();
  };

  list.addEventListener("pointerdown", down);
  list.addEventListener("dragstart", native);
  return () => {
    list.removeEventListener("pointerdown", down);
    list.removeEventListener("dragstart", native);
    pressed?.();
    unswallow?.();
  };
}
