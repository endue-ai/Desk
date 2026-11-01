/**
 * Pointer dragging with an 8 px threshold, so a click stays a click. Cursor is "grabbing" meanwhile.
 * The handle captures the pointer at once: a window's body is a plugin's frame, and a pointer that
 * crosses into a frame before the threshold would otherwise never report back to the desk.
 */

export const DRAG_THRESHOLD = 8;

export interface DragHandlers {
  /** Return false to ignore this pointer (a button inside the handle, say). */
  accept?(event: PointerEvent): boolean;
  start?(): void;
  move(dx: number, dy: number, event: PointerEvent): void;
  /** `event` is the pointer's last place, for what depends on where it was let go (snapping). */
  end(dx: number, dy: number, event: PointerEvent): void;
}

export function draggable(handle: HTMLElement, handlers: DragHandlers): () => void {
  const down = (e: PointerEvent) => {
    if (e.button !== 0 || (handlers.accept && !handlers.accept(e))) return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let dragging = false;
    try {
      handle.setPointerCapture?.(e.pointerId);
    } catch {
      // A pointer the browser no longer tracks: the drag still works over the desk's own DOM.
    }
    const move = (m: PointerEvent) => {
      const dx = m.clientX - x0;
      const dy = m.clientY - y0;
      if (!dragging && Math.hypot(dx, dy) <= DRAG_THRESHOLD) return;
      if (!dragging) {
        dragging = true;
        document.documentElement.classList.add("is-grabbing");
        handlers.start?.();
      }
      handlers.move(dx, dy, m);
    };
    const up = (u: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (!dragging) return;
      document.documentElement.classList.remove("is-grabbing");
      handlers.end(u.clientX - x0, u.clientY - y0, u);
      // The click that follows a drag is not a click.
      const swallow = (c: Event) => c.stopPropagation();
      window.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  handle.addEventListener("pointerdown", down);
  return () => handle.removeEventListener("pointerdown", down);
}
