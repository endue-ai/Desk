/**
 * Asking a plugin's frame for the state to keep before it is unloaded (ui.surface.state, ADR 0070):
 * an answer within two seconds whose `state` is JSON of at most 64 KiB is kept; anything else
 * (no answer, an error, unknown_command, too much) keeps nothing, and the surface comes back cold.
 */
import type { UiSurfaceStateParams } from "@endue-ai/bridge";
import type { FrameTimers } from "./policy";

export const SURFACE_STATE = "ui.surface.state";
/** The most the runtime keeps per surface, in bytes of UTF-8 JSON. */
export const STATE_LIMIT = 64 * 1024;
/** How long a frame has to answer. */
export const ANSWER_MS = 2000;

/** Ask with `ask` (a request to the plugin's frame); resolves with the state to keep, or undefined. */
export function askState(
  ask: (params: UiSurfaceStateParams) => Promise<unknown>,
  params: UiSurfaceStateParams,
  timers: FrameTimers,
): Promise<unknown> {
  return new Promise((resolve) => {
    const cancel = timers.after(ANSWER_MS, () => resolve(undefined));
    ask(params).then(
      (answer) => {
        cancel();
        resolve(keptState(answer));
      },
      () => {
        cancel();
        resolve(undefined);
      },
    );
  });
}

/** The `state` of an answer when it is JSON of at most 64 KiB, as a copy; else undefined. */
export function keptState(answer: unknown): unknown {
  if (typeof answer !== "object" || answer === null || !("state" in answer)) return undefined;
  let json: string | undefined;
  try {
    json = JSON.stringify((answer as { state: unknown }).state);
  } catch {
    return undefined;
  }
  if (json === undefined || new TextEncoder().encode(json).length > STATE_LIMIT) return undefined;
  return JSON.parse(json);
}
