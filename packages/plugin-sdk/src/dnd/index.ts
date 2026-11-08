// ctx.dnd (ADR 0119): a frame's drag sources and drop targets over the frame protocol.
import { draggable } from "../drag";
import type { HostMessage, Transport } from "../protocol";
import { dndSource } from "./source";
import { dndTarget } from "./target";
import type { PluginDnd } from "./types";

export function dndFor(transport: Transport): {
  api: PluginDnd;
  handle(message: HostMessage): boolean;
} {
  const source = dndSource(transport);
  const target = dndTarget(transport);
  const api: PluginDnd = {
    startDrag: source.startDrag,
    onDrop: target.onDrop,
    acceptTypes: target.acceptTypes,
    draggable: (list, options) => draggable(list, options, source.startDrag),
    get dragging() {
      return source.dragging;
    },
  };
  return { api, handle: (message) => source.handle(message) || target.handle(message) };
}
