/**
 * The microphone on the rail (ADR 0245): while anything captures, whichever plugin started it, the
 * Listen button is on with a dot and names who listens, and pressing it stops every capture. With
 * nothing capturing it is Hey Eris's button, as it was. The captures come from the bridge
 * (`audio.capturing`); a host without them has no captures.
 */
import type { CaptureInForce } from "../bridge/types";
import type { ShellCtx } from "./context";

/** Who started a capture, as the label says it: the runtime is Eris. */
const nameOf = (caller: string) => (caller === "desk" ? "Eris" : caller);

export interface MicWatch {
  /** The captures in force now, in the order they started. */
  captures(): readonly CaptureInForce[];
  dispose(): void;
}

/**
 * Follow the captures in force, from the list the bridge hands over now; `changed` runs after each
 * later change (the caller draws once itself after this returns).
 */
export function watchMic(ctx: ShellCtx, changed: () => void): MicWatch {
  let now: readonly CaptureInForce[] = [];
  let watching = false;
  const off = ctx.bridge.audio?.captures?.((captures) => {
    now = captures;
    if (watching) changed();
  });
  watching = true;
  return {
    captures: () => now,
    dispose: () => off?.(),
  };
}

/** The Listen button's label while `captures` run: the microphone, on, and who listens. */
export function micLabel(ctx: ShellCtx, captures: readonly CaptureInForce[]): string {
  const who = [...new Set(captures.map((c) => nameOf(c.caller)))].join(", ");
  return `${ctx.tr("mic")} · ${ctx.tr("on")} · ${who}`;
}

/** The person pressed the microphone: every capture stops, and Hey Eris with them. */
export async function stopEveryCapture(
  ctx: ShellCtx,
  captures: readonly CaptureInForce[],
): Promise<void> {
  if (ctx.store.get().listening) ctx.store.set({ listening: false });
  const stop = ctx.bridge.audio?.stopCapture;
  if (!stop) return;
  for (const { captureId } of captures) await stop(captureId).catch(() => {});
}
