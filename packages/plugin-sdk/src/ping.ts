/**
 * The frame's answer to the desk's pings (#39, #32 §9). From the moment the SDK loads in a frame,
 * every `desk:ping` from the desk gets a `desk:pong` with the same number, from this listener alone:
 * no plugin code runs on the way. A plugin that awaits a slow call, or has not finished mounting,
 * still answers; a frame whose page stopped taking messages does not, and its window says so.
 */

type FrameWindow = Pick<Window, "addEventListener" | "removeEventListener"> & {
  parent: { postMessage(message: unknown, targetOrigin: string): void };
};

/** Answer the parent's pings in `win`; returns the function that stops. */
export function answerPings(win: FrameWindow): () => void {
  const onMessage = (event: Event) => {
    const { data, source } = event as MessageEvent;
    const ping = data as { type?: unknown; n?: unknown } | null;
    if (source !== win.parent || ping?.type !== "desk:ping") return;
    const n = typeof ping.n === "number" ? ping.n : 0;
    win.parent.postMessage({ type: "desk:pong", n }, "*");
  };
  win.addEventListener("message", onMessage);
  return () => win.removeEventListener("message", onMessage);
}

/** Answer pings in this frame, when the SDK runs in one (never in a worker, a test or a top window). */
export function framePings(): (() => void) | undefined {
  if (typeof window === "undefined" || !window.parent || window.parent === window) return undefined;
  return answerPings(window);
}
