// Drag and drop for the plugin host (ADR 0119): the broker over the desk's page and its drag layer.
// The page's DOM is touched on the first drag only, so a host without a document (unit tests) still
// routes the messages. Drags from the OS reach the desk through the compositor's input (#56, #83).
import { DragBroker } from "./broker";
import { frameGeometry } from "./frames";
import { dragLayer } from "./layer";
import type { DndHostMessage } from "./types";

export interface Dnd {
  /** A frame's message; true when it was about drag and drop (the host then ignores it). */
  message(id: string, message: unknown): boolean;
  /** A plugin's frame went away: unloaded or unmounted. */
  gone(id: string): void;
  stop(): void;
}

/** `deps.frame` finds a plugin's frame window; `mounted` lists the plugins that have one. */
export function installDnd(
  deps: { win: Window; frame(id: string): Window | null },
  mounted: () => string[],
): Dnd {
  let page: { geometry: ReturnType<typeof frameGeometry>; layer: ReturnType<typeof dragLayer> };
  const dom = () => {
    page ??= {
      geometry: frameGeometry(deps.win.document, (id) => deps.frame(id), mounted),
      layer: dragLayer(deps.win.document, {
        move: (at, keys) => broker.pointer(at, keys),
        up: (at, keys) => void broker.release(at, keys),
        cancel: () => broker.cancel(),
      }),
    };
    return page;
  };
  const broker = new DragBroker({
    pluginAt: (x, y) => dom().geometry.pluginAt(x, y),
    toFrame: (id, at) => dom().geometry.toFrame(id, at),
    toPage: (id, at) => dom().geometry.toPage(id, at),
    post: (id, message: DndHostMessage) => deps.frame(id)?.postMessage(message, "*"),
    gesture: () => deps.win.navigator?.userActivation?.isActive,
    layer: {
      show: (image, at, shield) => dom().layer.show(image, at, shield),
      move: (at, effect) => page?.layer.move(at, effect),
      hide: () => page?.layer.hide(),
    },
  });
  return {
    message: (id, message) => broker.message(id, message),
    gone: (id) => broker.gone(id),
    stop: () => broker.cancel(),
  };
}
