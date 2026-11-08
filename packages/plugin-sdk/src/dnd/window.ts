// What a frame's transport does for drag and drop (ADR 0119): it follows the pointer and the keys while
// a drag from the frame lasts, finds the element under a point, and shows the answered effect as the
// cursor. The pointer stays with the frame where it was pressed while the button is down (WebKit's
// subframe capture, pointer capture elsewhere), so moves outside the frame still arrive here.
import type { FollowHandlers, Transport } from "../protocol";
import type { DragKeys, DropAnswer, PointerLike } from "./types";

const CURSORS: Record<DropAnswer, string> = {
  copy: "copy",
  move: "grabbing",
  link: "alias",
  none: "no-drop",
};
const CAPTURE = { capture: true };
const keysOf = (event: KeyboardEvent | PointerEvent): DragKeys => ({
  alt: event.altKey,
  shift: event.shiftKey,
  ctrl: event.ctrlKey,
  meta: event.metaKey,
});

export function windowDnd(
  win: Window,
): Pick<Transport, "follow" | "elementAt" | "cursor" | "pointer"> {
  let last: { x: number; y: number } | undefined;
  const seen = (event: PointerEvent) => {
    last = { x: event.clientX, y: event.clientY };
  };
  win.addEventListener?.("pointerdown", seen, { capture: true, passive: true });
  win.addEventListener?.("pointermove", seen, { capture: true, passive: true });
  let style: HTMLStyleElement | undefined;

  const follow = (from: PointerLike | undefined, handlers: FollowHandlers) => {
    const id = from?.pointerId;
    let at = from ? { x: from.clientX, y: from.clientY } : (last ?? { x: 0, y: 0 });
    let keys: DragKeys = { alt: false, shift: false, ctrl: false, meta: false };
    const holder = from?.target as Element | null | undefined;
    try {
      if (id !== undefined) holder?.setPointerCapture?.(id);
    } catch {
      // The pointer may be up already; the frame keeps it while the button is down anyway.
    }
    const mine = (event: PointerEvent) => id === undefined || event.pointerId === id;
    const move = (event: PointerEvent) => {
      if (!mine(event)) return;
      event.preventDefault();
      at = { x: event.clientX, y: event.clientY };
      keys = keysOf(event);
      handlers.move(at.x, at.y, keys);
    };
    const up = (event: PointerEvent) => {
      if (!mine(event)) return;
      stop();
      handlers.end(event.clientX, event.clientY, keysOf(event));
    };
    const cancel = (event: Event) => {
      if ("pointerId" in event && !mine(event as PointerEvent)) return;
      stop();
      handlers.cancel();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && event.type === "keydown") {
        event.preventDefault();
        event.stopImmediatePropagation();
        stop();
        handlers.cancel();
        return;
      }
      // Alt or Mod pressed or let go without moving changes the effect.
      keys = keysOf(event);
      handlers.move(at.x, at.y, keys);
    };
    const on = [
      ["pointermove", move],
      ["pointerup", up],
      ["pointercancel", cancel],
      ["blur", cancel],
      ["keydown", key],
      ["keyup", key],
    ] as const;
    for (const [name, listener] of on)
      win.addEventListener(name, listener as EventListener, CAPTURE);
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      for (const [name, listener] of on)
        win.removeEventListener(name, listener as EventListener, CAPTURE);
      try {
        if (id !== undefined) holder?.releasePointerCapture?.(id);
      } catch {
        // Already released, or the element is gone.
      }
    };
    win.getSelection?.()?.removeAllRanges();
    return stop;
  };

  return {
    follow,
    elementAt: (x, y) => win.document.elementFromPoint(x, y),
    pointer: () => last,
    // Every element, its own cursor rule included, shows the effect while the drag lasts.
    cursor: (effect) => {
      if (effect === undefined) {
        style?.remove();
        style = undefined;
        return;
      }
      style ??= win.document.head.appendChild(win.document.createElement("style"));
      style.textContent = `*, *::before, *::after { cursor: ${CURSORS[effect]} !important; }`;
    },
  };
}
