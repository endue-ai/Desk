/**
 * What Eris knows past the windows on screen (ADR 0124), for each desk by its store: the log of the
 * windows closed recently and the summary of what the person can do. deskSnapshot reads them here,
 * so the composer and desk.windows.list carry them without knowing who keeps them.
 */
import type { BrainDeskCapabilities } from "@endue-ai/bridge";
import type { Store } from "../shell/state";
import type { ClosedLog } from "./closed";

export interface ErisContext {
  closed?: ClosedLog;
  capabilities?: () => BrainDeskCapabilities;
}

const contexts = new WeakMap<Store, ErisContext>();

export const contextOf = (store: Store): ErisContext => contexts.get(store) ?? {};

/** Provide parts of a desk's context; returns what takes them back again. */
export function provide(store: Store, part: ErisContext): () => void {
  contexts.set(store, { ...contextOf(store), ...part });
  return () => {
    const now: ErisContext = { ...contextOf(store) };
    if (part.closed && now.closed === part.closed) delete now.closed;
    if (part.capabilities && now.capabilities === part.capabilities) delete now.capabilities;
    contexts.set(store, now);
  };
}
