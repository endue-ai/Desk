// Compositor mode's window manager (#80, ADR 0153): crates/desk-wm drags, resizes, snaps and pans
// windows on the compositor's input, and runs the desk's window commands. This page tells it what a
// press lands on (`compositor_grab`, from the runtime's gesture handlers) and forwards the window
// commands (`compositor_wm`), sending what changed of the desk before either, so desk-wm acts on
// the same windows.
// It hears back each change desk-wm made (`desk://compositor-wm`), which the runtime takes as the
// truth, the window it lays out where a gesture holds it (`desk://compositor-held`), and the
// commands a placeholder card's buttons run (`desk://compositor-run`); the next report says which
// change it took and where it laid the held window out.
import type { Desk, Grab, WindowManagerHost, WindowOp, WmPublished } from "@endue-ai/runtime";
import type { Held, WmState } from "./compositor-desk";

type Send = (command: string, args: Record<string, unknown>) => void;

/** The seam: the host the runtime runs its gestures and window commands through, and its state. */
export interface WmSeam {
  host: WindowManagerHost;
  /** What the next report adds. */
  state(): WmState;
  /**
   * Send what changed of the desk before a grab or a window command (the desk's report, once it
   * runs), answering the last report's sequence number.
   */
  flushWith(flush: () => number): void;
  /** desk-wm changed the desk: the runtime takes it. */
  took(published: WmPublished, desk: Pick<Desk, "takeWm">): void;
  /** desk-wm holds `window` at `rect`, or lets it go. */
  held(payload: HeldPayload, desk: Pick<Desk, "hold">): void;
}

export interface HeldPayload {
  window: string | null;
  rect?: { x: number; y: number; w: number; h: number };
}

export function wmSeam(send: Send): WmSeam {
  let applied = 0;
  let held: Held | undefined;
  let flush: () => number = () => 0;
  return {
    host: {
      // The desk goes first, and the shell holds each call until it has that desk (`after`): the
      // page's calls run on threads of their own there, so one may overtake another.
      grab: (gesture: Grab, at) => {
        const after = flush();
        send("compositor_grab", { gesture, x: at.x, y: at.y, after });
      },
      run: (op: WindowOp, window?: string) => {
        const after = flush();
        send("compositor_wm", { op, ...(window ? { window } : {}), after });
      },
    },
    state: () => ({ applied, ...(held ? { held } : {}) }),
    flushWith(next) {
      flush = next;
    },
    took(published, desk) {
      desk.takeWm(published);
      applied = Math.max(applied, published.rev);
    },
    held(payload, desk) {
      const { window, rect } = payload;
      held = window && rect ? { window, ...rect } : undefined;
      desk.hold(window, rect);
    },
  };
}

/** What a card's button asks the page to run. */
export interface RunPayload {
  command?: unknown;
  args?: unknown;
}

/** The desk command a card's button runs, if the payload names one of the frames' own. */
export function cardCommand(payload: RunPayload): { command: string; args: unknown } | undefined {
  const { command, args } = payload;
  if (typeof command !== "string" || !/^desk\.frames\.(wait|stop|reload)$/.test(command)) return;
  return { command, args };
}
