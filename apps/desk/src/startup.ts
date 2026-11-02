/**
 * The start-up report. When `DESK_TRACE` is on (`desk_ready` answers so), the runtime's phases go
 * to the app's trace (`desk_trace`, crates/desk-trace) once the desk is ready, and again with the
 * first interactive frame: from desk ready to the frame that shows it. The ready line is never kept
 * waiting for either.
 */
import { type Phase, phase, phases } from "@endue-ai/runtime";

/** The phase from desk ready to the second animation frame after it. */
export const FIRST_FRAME = "first interactive frame";

export type StartupPhase = Phase;

type Frame = (callback: (at: number) => void) => unknown;

/**
 * The time of the second animation frame from now: the first one's callbacks run before it paints
 * what the page holds, so the second starts once that was painted.
 */
export function nextPaint(
  request: Frame = (callback) => requestAnimationFrame(callback),
): Promise<number> {
  return new Promise((resolve) => request(() => request(resolve)));
}

export interface StartupReport {
  /** What `desk_ready` answered: whether the app keeps a start-up trace. */
  tracing: boolean;
  /** When the desk was ready (ms from the page's time origin). */
  ready: number;
  /** When the first frame after ready was painted ({@link nextPaint}, asked for at ready). */
  painted: Promise<number>;
  /** Hand the phases so far to the app; each report replaces the one before. */
  send(phases: StartupPhase[]): Promise<unknown>;
}

/** Report the phases at ready, then again with the first interactive frame. Never throws. */
export async function reportStartup(report: StartupReport): Promise<void> {
  if (!report.tracing) return;
  try {
    await report.send(phases());
    phase(FIRST_FRAME, report.ready, await report.painted);
    await report.send(phases());
  } catch {
    // The app could not take it: its trace lacks the runtime's phases, and the desk runs on.
  }
}
