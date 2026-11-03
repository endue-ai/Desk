/**
 * The frame's first `ready` (ADR 0061). From the moment the SDK loads until the plugin has mounted,
 * an uncaught error or rejection in the frame is a failed start: the desk hears `desk:failed` once and
 * counts it toward quarantine. Once the plugin is ready, errors are the plugin's own business.
 */

/** What the frame tells its parent about its start. */
export interface StartWatch {
  /** The plugin mounted: tell the desk, and stop watching. */
  ready(): void;
  /** The plugin failed to start: tell the desk, and stop watching. */
  failed(message: string): void;
  /** Whether the start was already reported. */
  readonly settled: boolean;
}

type FrameWindow = Pick<Window, "addEventListener" | "removeEventListener"> & {
  parent: { postMessage(message: unknown, targetOrigin: string): void };
};

/** Why an error event or a rejection happened, in one line. */
function messageOf(event: Event): string {
  const reason = (event as Event & { reason?: unknown }).reason;
  const error = (event as Event & { error?: unknown }).error ?? reason;
  if (error instanceof Error && error.message) return error.message;
  const message = (event as Event & { message?: unknown }).message;
  if (typeof message === "string" && message) return message;
  return reason === undefined ? "the frame failed to start" : String(reason);
}

/** Watch `win` for errors until the start is reported, either way. */
export function watchStart(win: FrameWindow): StartWatch {
  let settled = false;
  const onError = (event: Event) => watch.failed(messageOf(event));
  const settle = (message: { type: string; message?: string }) => {
    if (settled) return;
    settled = true;
    win.removeEventListener("error", onError);
    win.removeEventListener("unhandledrejection", onError);
    win.parent.postMessage(message, "*");
  };
  const watch: StartWatch = {
    ready: () => settle({ type: "desk:ready" }),
    failed: (message) => settle({ type: "desk:failed", message }),
    get settled() {
      return settled;
    },
  };
  win.addEventListener("error", onError);
  win.addEventListener("unhandledrejection", onError);
  return watch;
}

/** The watch of this frame, when the SDK runs in one (never in a worker, a test or a top window). */
export function frameStart(): StartWatch | undefined {
  if (typeof window === "undefined" || !window.parent || window.parent === window) return undefined;
  return watchStart(window);
}
