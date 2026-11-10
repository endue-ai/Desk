/**
 * A plugin frame's reload (a hot reload on `plugin.changed`, ADR 0012) waits until what the frame
 * already sent has reached the desk. Chromium hands the desk a message from a page that has gone with
 * no `source`, and the desk drops a message it cannot tell from another plugin's (ADR 0012): the
 * desk:state a plugin set just before the reload was lost, and the frame came back with an older one.
 * A frame's messages reach the desk in the order it posted them, and the SDK answers a ping by itself
 * from its import (`plugin-sdk/src/ping.ts`, #39), so once the frame's own pong is in, everything it
 * sent before has arrived from its window. A frame that has not answered within DRAIN_MS (wedged, its
 * next page still loading, or an SDK from before #39) reloads all the same, and one that is not on the
 * page or has not said hello reloads at once: it has nothing on its way.
 */
import type { FrameTimers } from "./policy";

/** How long a reload waits for the frame's answer, in ms. */
export const DRAIN_MS = 500;

export interface ReloadDeps {
  /** The desk's window, where the frame's answers arrive. */
  win: Pick<Window, "addEventListener" | "removeEventListener">;
  /** Surface `id`'s frame when it is on the page and said hello; null when there is none to wait on. */
  live(id: string): Window | null;
  /** Load `src` in surface `id`'s frame now. */
  load(id: string, src: string): void;
  timers: FrameTimers;
}

export interface FrameReloads {
  /** Load `src` in surface `id`'s frame once what the frame sent has arrived; a later `src` wins. */
  reload(id: string, src: string): void;
  /** Surface `id` closed: a reload that waits for its frame is dropped. */
  forget(id: string): void;
  dispose(): void;
}

interface Waiting {
  src: string;
  stop(): void;
}

export function frameReloads(deps: ReloadDeps): FrameReloads {
  const waiting = new Map<string, Waiting>();
  // Below the watch's pings, which count up from 1, so neither answer is taken for the other.
  let next = 0;

  const drop = (id: string) => {
    waiting.get(id)?.stop();
    waiting.delete(id);
  };

  const reload = (id: string, src: string) => {
    const pending = waiting.get(id);
    if (pending) {
      pending.src = src;
      return;
    }
    const frame = deps.live(id);
    if (!frame) {
      deps.load(id, src);
      return;
    }
    const n = --next;
    const entry: Waiting = { src, stop: () => {} };
    const done = () => {
      if (waiting.get(id) !== entry) return;
      drop(id);
      deps.load(id, entry.src);
    };
    // Only this frame's answer to this ping says its messages are in: never another frame's (ADR 0012).
    const onMessage = (event: MessageEvent) => {
      const pong = event.data as { type?: unknown; n?: unknown } | null;
      if (event.source === frame && pong?.type === "desk:pong" && pong.n === n) done();
    };
    deps.win.addEventListener("message", onMessage);
    const cancel = deps.timers.after(DRAIN_MS, done);
    entry.stop = () => {
      deps.win.removeEventListener("message", onMessage);
      cancel();
    };
    waiting.set(id, entry);
    frame.postMessage({ type: "desk:ping", n }, "*");
  };

  return {
    reload,
    forget: drop,
    dispose() {
      for (const id of [...waiting.keys()]) drop(id);
    },
  };
}
