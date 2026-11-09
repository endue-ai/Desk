/**
 * Pointer capture starts at once so crossing a plugin frame cannot lose the drag. Once it moves, a
 * drag lasts until the button is let go: a frame taking the focus as it redraws (the desk keeps it,
 * in that frame) does not end it; the desk losing the focus, Escape or a cancelled pointer do.
 */
export const DRAG_THRESHOLD = 8;

export interface DragHandlers {
  /** Return false to ignore this pointer (a button inside the handle, say). */
  accept?(event: PointerEvent): boolean;
  cursor?:
    | "grabbing"
    | "col-resize"
    | "row-resize"
    | "nwse-resize"
    | "nesw-resize"
    | "ns-resize"
    | "ew-resize";
  start?(): void;
  move(dx: number, dy: number, event: PointerEvent): void;
  /** `event` is the pointer's last place, for snapping on a successful drop. */
  end(dx: number, dy: number, event: PointerEvent): void;
  /** Restore the preview without saving when interrupted, including during disposal. */
  cancel?(): void;
}

export function draggable(handle: HTMLElement, handlers: DragHandlers): () => void {
  const doc = handle.ownerDocument;
  const win = doc.defaultView ?? window;
  const root = doc.documentElement;
  let cancel: (() => void) | undefined;
  let clearClick: (() => void) | undefined;
  const down = (e: PointerEvent) => {
    if (cancel || e.button !== 0 || !e.isPrimary || handlers.accept?.(e) === false) return;
    // Native selection begins on press, before the movement threshold. Cancelling only pointermove
    // is too late, especially when focusing the window redraws the title under the pointer.
    e.preventDefault();
    clearClick?.();
    const x0 = e.clientX;
    const y0 = e.clientY;
    let dragging = false;
    /** The pointer's last place in the drag. */
    let last: PointerEvent | undefined;
    const previousCursor = root.style.getPropertyValue("--desk-drag-cursor");
    const previousPriority = root.style.getPropertyPriority("--desk-drag-cursor");
    try {
      handle.setPointerCapture?.(e.pointerId);
    } catch {
      // The browser may already have stopped tracking this pointer.
    }
    const cleanup = () => {
      cancel = undefined;
      win.removeEventListener("pointermove", move);
      win.removeEventListener("pointerup", up);
      win.removeEventListener("pointercancel", interrupted);
      win.removeEventListener("blur", blurred);
      win.removeEventListener("keydown", key, true);
      handle.removeEventListener("lostpointercapture", interrupted);
      if (dragging) {
        root.classList.remove("is-grabbing");
        if (previousCursor)
          root.style.setProperty("--desk-drag-cursor", previousCursor, previousPriority);
        else root.style.removeProperty("--desk-drag-cursor");
      }
      try {
        handle.releasePointerCapture?.(e.pointerId);
      } catch {
        // A cancelled or removed handle may have lost capture already.
      }
    };
    const abort = () => {
      cleanup();
      if (dragging) handlers.cancel?.();
    };
    // The page's window blurs when the focus moves into one of its frames, too: a plugin focusing
    // itself as it redraws. Only the desk losing the focus (another app in front) ends the drag.
    const blurred = () => {
      win.setTimeout(() => {
        if (cancel === abort && !doc.hasFocus()) abort();
      }, 0);
    };
    const interrupted = (event: PointerEvent) => {
      if (event.pointerId === e.pointerId) abort();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      abort();
    };
    const move = (m: PointerEvent) => {
      if (m.pointerId !== e.pointerId) return;
      // The button is up: it was let go where the desk could not hear it (over another app, once a
      // frame had the focus). The drag ends where the pointer last was in it.
      if ((m.buttons & 1) === 0) {
        finish(last ?? m);
        return;
      }
      const dx = m.clientX - x0;
      const dy = m.clientY - y0;
      if (!dragging && Math.hypot(dx, dy) <= DRAG_THRESHOLD) return;
      if (!dragging) {
        dragging = true;
        doc.getSelection()?.removeAllRanges();
        root.style.setProperty("--desk-drag-cursor", handlers.cursor ?? "grabbing");
        root.classList.add("is-grabbing");
        handlers.start?.();
      }
      m.preventDefault();
      last = m;
      handlers.move(dx, dy, m);
    };
    const up = (u: PointerEvent) => {
      if (u.pointerId === e.pointerId) finish(u);
    };
    const finish = (u: PointerEvent) => {
      cleanup();
      if (!dragging) return;
      // The click that follows a drag must not activate anything under the drop.
      const swallow = (c: Event) => {
        c.preventDefault();
        c.stopImmediatePropagation();
      };
      win.addEventListener("click", swallow, { capture: true, once: true });
      const timer = win.setTimeout(() => clearClick?.(), 0);
      clearClick = () => {
        win.clearTimeout(timer);
        win.removeEventListener("click", swallow, true);
        clearClick = undefined;
      };
      handlers.end(u.clientX - x0, u.clientY - y0, u);
    };
    cancel = abort;
    win.addEventListener("pointermove", move);
    win.addEventListener("pointerup", up);
    win.addEventListener("pointercancel", interrupted);
    win.addEventListener("blur", blurred);
    win.addEventListener("keydown", key, true);
    handle.addEventListener("lostpointercapture", interrupted);
  };
  handle.addEventListener("pointerdown", down);
  return () => {
    handle.removeEventListener("pointerdown", down);
    cancel?.();
    clearClick?.();
  };
}
