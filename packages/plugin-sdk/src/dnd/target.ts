// Drop targets in a frame. The frame tells the runtime every type its targets accept, so a drag of
// other types never reaches it. While a drag hovers, the target under the pointer answers the effect
// it would perform and its landing element carries `data-desk-drop="<effect>"` for the plugin's CSS;
// a drop calls its handler with the items it accepts and answers the effect it performed.
import type { HostMessage, Transport } from "../protocol";
import { ALL_TYPES, answerFor, dropOf, taken, takes, typeOf } from "./data";
import type {
  DragKeys,
  DragOver,
  DropAnswer,
  DropEffect,
  DropHandler,
  DropOptions,
  DropTarget,
} from "./types";

interface Registration {
  handler: DropHandler;
  options: DropOptions;
}
interface Hovering {
  drag: number;
  types: string[];
  effectAllowed: DropEffect[];
  from: string;
}

const ATTRIBUTE = "data-desk-drop";
type Marked = {
  setAttribute?(name: string, value: string): void;
  removeAttribute?(name: string): void;
};
const parentOf = (node: unknown) => (node as { parentNode?: unknown } | null)?.parentNode ?? null;

export function dndTarget(transport: Transport) {
  const targets = new Map<DropTarget, Registration>();
  const accepted = new WeakMap<DropTarget, readonly string[]>();
  let announced = "";
  let queued = false;
  let hovering: Hovering | undefined;
  let marked: Marked | undefined;

  const acceptOf = (target: DropTarget, registration: Registration) =>
    accepted.get(target) ?? registration.options.accept ?? ALL_TYPES;
  /** Tell the runtime every type the targets accept, once per change. */
  const announce = () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      const types = [...new Set([...targets].flatMap(([t, r]) => [...acceptOf(t, r)]))].sort();
      const key = types.join("\n");
      if (key === announced) return;
      announced = key;
      transport.send({ type: "desk:drop-types", types });
    });
  };

  /** Mark the landing element with the effect, and only it. */
  const mark = (element: unknown, effect: DropAnswer) => {
    const next = effect === "none" ? undefined : (element as Marked | undefined);
    if (marked && marked !== next) marked.removeAttribute?.(ATTRIBUTE);
    marked = next;
    marked?.setAttribute?.(ATTRIBUTE, effect);
  };

  /** The target under a point and the element the drop lands on there. */
  const find = (x: number, y: number) => {
    const only = targets.size === 1 ? [...targets.keys()][0] : undefined;
    const under = transport.elementAt?.(x, y) ?? only ?? null;
    for (let node: unknown = under; node; node = parentOf(node)) {
      const registration = targets.get(node as DropTarget);
      if (!registration) continue;
      const element = registration.options.at ? registration.options.at(under) : node;
      return element === null || element === undefined
        ? undefined
        : { target: node as DropTarget, registration, element };
    }
    return undefined;
  };

  /** The hover's facts for the target under the point, and the effect it answers. */
  const answer = (x: number, y: number, keys: DragKeys) => {
    const found = hovering && find(x, y);
    if (!hovering || !found) return { effect: "none" as DropAnswer };
    const types = taken(acceptOf(found.target, found.registration), hovering.types);
    const { effectAllowed, from } = hovering;
    const over: DragOver = { types, effectAllowed, from, keys, element: found.element, x, y };
    const effect = types.length === 0 ? "none" : answerFor(over, found.registration.options);
    return { effect, over, found };
  };

  const hover = (drag: number, seq: number, x: number, y: number, keys: DragKeys) => {
    if (hovering?.drag !== drag) return;
    const { effect, found } = answer(x, y, keys);
    mark(found?.element, effect);
    transport.send({ type: "desk:drag-status", drag, seq, effect });
  };

  const drop = async (message: Extract<HostMessage, { type: "desk:drop" }>) => {
    const { drag, x, y, keys } = message;
    const { effect, over, found } = answer(x, y, keys);
    mark(undefined, "none");
    hovering = undefined;
    let done: DropAnswer = "none";
    if (effect !== "none" && over && found) {
      const accept = acceptOf(found.target, found.registration);
      const items = message.items.filter((item) => accept.some((p) => takes(p, typeOf(item))));
      try {
        done = (await found.registration.handler(dropOf(over, effect, items))) ?? effect;
      } catch {
        done = "none";
      }
      if (done !== "none" && !over.effectAllowed.includes(done)) done = "none";
    }
    transport.send({ type: "desk:drop-done", drag, effect: done });
  };

  /** A message for the frame's targets; false when it is not one. */
  const handle = (message: HostMessage): boolean => {
    switch (message.type) {
      case "desk:dragenter": {
        const { drag, seq, types, effectAllowed, from } = message;
        hovering = { drag, types, effectAllowed, from };
        hover(drag, seq, message.x, message.y, message.keys);
        return true;
      }
      case "desk:dragover":
        hover(message.drag, message.seq, message.x, message.y, message.keys);
        return true;
      case "desk:dragleave":
        if (hovering?.drag === message.drag) {
          mark(undefined, "none");
          hovering = undefined;
        }
        return true;
      case "desk:drop":
        void drop(message);
        return true;
      default:
        return false;
    }
  };

  return {
    handle,
    onDrop(target: DropTarget, handler: DropHandler, options: DropOptions = {}) {
      const registration = { handler, options };
      targets.set(target, registration);
      announce();
      return () => {
        if (targets.get(target) !== registration) return;
        targets.delete(target);
        announce();
      };
    },
    acceptTypes(target: DropTarget, types: readonly string[]) {
      accepted.set(target, [...types]);
      announce();
    },
  };
}
