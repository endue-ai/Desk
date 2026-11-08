// The source of a drag, in its frame: `startDrag` hands the items to the runtime, follows the pointer
// and the modifier keys until the button is released or Escape is pressed, shows the effect the
// frame under the pointer answers as the cursor, and resolves once the runtime says how it ended.
import type { HostMessage, Transport } from "../protocol";
import { EFFECTS } from "./data";
import type { DragResult, DragStart } from "./types";

export function dndSource(transport: Transport) {
  let next = 1;
  /** The drag the pointer still holds, if any: one at a time. */
  let following: { drag: number; stop(): void } | undefined;
  /** Drags released or cancelled whose outcome the runtime has not told yet. */
  const outcomes = new Map<number, (result: DragResult) => void>();

  const startDrag = (start: DragStart): Promise<DragResult> => {
    if (following) return Promise.resolve({ effect: "none" });
    const drag = next++;
    const { event, image } = start;
    const at = event
      ? { x: event.clientX, y: event.clientY }
      : (transport.pointer?.() ?? { x: 0, y: 0 });
    const done = new Promise<DragResult>((resolve) => outcomes.set(drag, resolve));
    const release = () => {
      if (following?.drag !== drag) return;
      following.stop();
      following = undefined;
    };
    following = { drag, stop: () => {} };
    const stop = transport.follow?.(event, {
      move: (x, y, keys) => transport.send({ type: "desk:drag-move", drag, x, y, keys }),
      end: (x, y, keys) => {
        release();
        transport.send({ type: "desk:drag-end", drag, x, y, keys });
      },
      cancel: () => {
        release();
        transport.send({ type: "desk:drag-cancel", drag });
      },
    });
    if (following?.drag === drag && stop) following.stop = stop;
    transport.send({
      type: "desk:drag-start",
      drag,
      items: [...start.items],
      effectAllowed: [...(start.effectAllowed ?? EFFECTS)],
      ...(image ? { image } : {}),
      x: at.x,
      y: at.y,
    });
    return done;
  };

  /** A message for the source: feedback for the cursor, or how a drag ended. */
  const handle = (message: HostMessage): boolean => {
    if (message.type === "desk:drag-feedback") {
      if (following?.drag === message.drag) transport.cursor?.(message.effect);
      return true;
    }
    if (message.type !== "desk:drag-ended") return false;
    const resolve = outcomes.get(message.drag);
    if (!resolve) return true;
    outcomes.delete(message.drag);
    if (following?.drag === message.drag) {
      following.stop();
      following = undefined;
    }
    if (!following) transport.cursor?.(undefined);
    resolve({ effect: message.effect, ...(message.to ? { to: message.to } : {}) });
    return true;
  };

  return {
    startDrag,
    handle,
    get dragging() {
      return following !== undefined;
    },
  };
}
