// ui.surface.state (ADR 0070): before the desk unloads a surface nobody sees, it asks the frame for
// the state to keep, and hands it back as ctx.surface.restored when the surface shows again.
import type { UiSurfaceStateResult } from "@endue-ai/bridge";
import { CommandFailed } from "./commands";

/** The desk's request for the state to keep (specs/bridge/v0/ui.schema.json). */
export const SURFACE_STATE = "ui.surface.state";
/** The most the desk keeps, in bytes of UTF-8 JSON. */
export const STATE_LIMIT = 64 * 1024;

/**
 * The answer to ui.surface.state from what `provider` returns: `{}` for nothing to keep, else the
 * state as plain JSON. A state over 64 KiB fails instead, so the surface comes back cold.
 */
export function stateAnswer(provider: () => unknown): () => Promise<UiSurfaceStateResult> {
  return async () => {
    const state = await provider();
    const json = state === undefined ? undefined : JSON.stringify(state);
    if (json === undefined) return {};
    const size = new TextEncoder().encode(json).length;
    if (size > STATE_LIMIT) {
      const message = `the state is ${size} bytes; the desk keeps at most 64 KiB`;
      throw new CommandFailed(SURFACE_STATE, "failed", message);
    }
    return { state: JSON.parse(json) };
  };
}
