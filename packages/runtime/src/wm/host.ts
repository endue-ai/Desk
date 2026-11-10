/**
 * The window manager the runtime works through (#83): crates/desk-wm, which holds every window,
 * pane, desktop, the drawer and the pan. In the app it is the CEF shell's compositor (ADR 0153),
 * which also runs the gestures and the window commands on its input; a desk without the compositor
 * (the runtime's tests and fixture pages) runs the same window manager as WebAssembly
 * (`local.ts`). The runtime asks for every change as an edit and takes each desk the host
 * publishes (`connect`), whole. While a gesture holds a window, the page lays the window out where
 * it is held (`HeldWindows`), so what the page draws of it follows.
 */
import type { BrainDesk } from "@endue-ai/bridge";
import type { ResizeDirection } from "../surface/resize";
import type { Edit, Fill, Published, Rect, Told } from "./types";

/** What a press starts, as the page found it. */
export type Grab =
  | { kind: "move"; window: string }
  | { kind: "resize"; window: string; grip: ResizeDirection }
  | { kind: "pan" };

/** A window command (desk.display.*). */
export type WindowOp =
  | { op: "maximize" }
  | { op: "snap"; fill: Fill }
  | { op: "move"; dx: number; dy: number }
  | { op: "resize"; dw: number; dh: number };

export interface WindowManagerHost {
  /** Hear each desk the window manager publishes; the runtime takes it whole. */
  connect(take: (published: Published) => void): void;
  /** The runtime's `edits`, applied in order; each one's answer once the desk they made is in. */
  edit(edits: Edit[]): Promise<unknown[]>;
  /** What desk.windows.list answers, with the titles and frames the runtime knows. */
  snapshot(told: Told): Promise<BrainDesk>;
  /** The press at `at` (CSS pixels of the page) starts `grab`. */
  grab(grab: Grab, at: { x: number; y: number }): void;
  /** Run `op` on window `window`, or on the one in use. */
  run(op: WindowOp, window?: string): void;
  /**
   * The windows that keep a live frame, when the host keeps the live budget (the compositor's,
   * ADR 0151, from its plan); undefined until it has decided, or for a host without one: then
   * every window keeps its frame.
   */
  live?(): ReadonlySet<string> | undefined;
  /** Hear the live set change. */
  onLive?(listener: () => void): () => void;
}

/** No window manager: a desk that has none holds no window, and nothing it asks changes. */
export function noWindowManager(): WindowManagerHost {
  return {
    connect: () => undefined,
    edit: (edits) => Promise.resolve(edits.map(() => null)),
    snapshot: () => Promise.resolve({ screen: { w: 0, h: 0 }, windows: [] }),
    grab: () => undefined,
    run: () => undefined,
  };
}

/** Where the page lays out the window a host's gesture holds, if one. */
export interface HeldWindows {
  rect(id: string): Rect | undefined;
  /** Window `id` is held at `rect`; `null` lets every window go. */
  hold(id: string | null, rect?: Rect): void;
  onChange(listener: () => void): () => void;
}

export function heldWindows(): HeldWindows {
  let held: { id: string; rect: Rect } | undefined;
  const listeners = new Set<() => void>();
  return {
    rect: (id) => (held?.id === id ? held.rect : undefined),
    hold(id, rect) {
      held = id && rect ? { id, rect } : undefined;
      for (const listener of [...listeners]) listener();
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * The edits' answers by batch: a host numbers each batch, and the desk published with its answers
 * settles it. The desk is taken first, so a caller that waits reads the desk its edits made.
 */
export function answers() {
  const waiting = new Map<number, (values: unknown[]) => void>();
  let seq = 0;
  return {
    /** The next batch's number and its answers to come. */
    next(): { seq: number; done: Promise<unknown[]> } {
      const n = ++seq;
      const done = new Promise<unknown[]>((resolve) => waiting.set(n, resolve));
      return { seq: n, done };
    },
    /** What `published` answers settles its batch. */
    settle(published: Published): void {
      const answered = published.answered;
      if (!answered) return;
      waiting.get(answered.seq)?.(answered.values);
      waiting.delete(answered.seq);
    },
    /** The last batch's number. */
    last: () => seq,
  };
}
