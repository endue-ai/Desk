// The window manager in the app (#80, #83, ADR 0153): crates/desk-wm in the CEF shell holds the
// windows, panes, desktops, the drawer and the pan. This page is its host for the runtime: it sends
// the runtime's edits (`compositor_edit`, numbered, which the shell applies in order), what a press
// lands on (`compositor_grab`, from the runtime's gesture handlers) and the window commands
// (`compositor_wm`), each call naming the last edit it follows, and asks what desk.windows.list
// answers (`compositor_snapshot`). It hears back each desk desk-wm publishes (`desk://compositor-wm`),
// which the runtime takes whole, the window it lays out where a gesture holds it
// (`desk://compositor-held`), the windows that keep a live frame (`desk://compositor-live`) and the
// commands a placeholder card's buttons run (`desk://compositor-run`); the next report says which
// desk it took and where it laid the held window out.
import { answers, type Desk, type Published, type WindowManagerHost } from "@endue-ai/runtime";
import type { Held, WmState } from "./compositor-desk";

type Send = (command: string, args: Record<string, unknown>) => void;
type Ask = <T>(command: string, args: Record<string, unknown>) => Promise<T>;

/** The seam: the host the runtime works through, and what the page's report adds. */
export interface WmSeam {
  host: WindowManagerHost;
  /** What the next report adds. */
  state(): WmState;
  /** desk-wm published a desk: the runtime takes it. */
  took(published: Published): void;
  /** desk-wm holds `window` at `rect`, or lets it go. */
  held(payload: HeldPayload, desk: Pick<Desk, "hold">): void;
  /** The windows that keep a live frame, as desk-wm's budget decided. */
  live(ids: readonly string[]): void;
}

export interface HeldPayload {
  window: string | null;
  rect?: { x: number; y: number; w: number; h: number };
}

export function wmSeam(send: Send, ask: Ask): WmSeam {
  let applied = 0;
  let held: Held | undefined;
  let take: (published: Published) => void = () => undefined;
  let kept: Set<string> | undefined;
  const listening = new Set<() => void>();
  const pending = answers();
  return {
    host: {
      connect(next) {
        take = next;
      },
      // Numbered: the shell runs each page call on a thread of its own, so one may overtake
      // another; it applies them in order, and holds a call until the edit it follows (`after`).
      edit(edits) {
        const { seq, done } = pending.next();
        send("compositor_edit", { seq, edits });
        return done;
      },
      snapshot: (told) => ask("compositor_snapshot", { told, after: pending.last() }),
      grab: (gesture, at) =>
        send("compositor_grab", { gesture, x: at.x, y: at.y, after: pending.last() }),
      run: (op, window) =>
        send("compositor_wm", { op, ...(window ? { window } : {}), after: pending.last() }),
      live: () => kept,
      onLive(listener) {
        listening.add(listener);
        return () => listening.delete(listener);
      },
    },
    state: () => ({ applied, ...(held ? { held } : {}) }),
    took(published) {
      applied = Math.max(applied, published.rev);
      take(published);
      pending.settle(published);
    },
    held(payload, desk) {
      const { window, rect } = payload;
      held = window && rect ? { window, ...rect } : undefined;
      desk.hold(window, rect);
    },
    live(ids) {
      kept = new Set(ids);
      for (const listener of [...listening]) listener();
    },
  };
}

/** What a card's button asks the page to run. */
export interface RunPayload {
  command?: unknown;
  args?: unknown;
}

/** The commands the compositor's own chrome runs: a card's buttons and the spread's pick (#54). */
const CHROME = /^desk\.(frames\.(wait|stop|reload)|windows\.focus)$/;

/** The desk command the compositor's chrome runs, if the payload names one of those. */
export function cardCommand(payload: RunPayload): { command: string; args: unknown } | undefined {
  const { command, args } = payload;
  if (typeof command !== "string" || !CHROME.test(command)) return;
  return { command, args };
}
