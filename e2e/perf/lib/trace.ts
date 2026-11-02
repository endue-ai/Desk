// Start-up times from a trace the app wrote with DESK_TRACE=1 (crates/desk-trace): ms from process
// start to the ready line and to the end of the first interactive frame. Pure: trace.test.ts.
import { round1 } from "./stats";

/** The instant the app printed its ready line. */
export const READY_LINE = "ready line";
/** The runtime's phase from desk ready to the frame that shows it. */
export const FIRST_FRAME = "first interactive frame";

interface TraceEvent {
  name?: unknown;
  ph?: unknown;
  ts?: unknown;
  dur?: unknown;
}

/** The events of a trace in either of the format's forms: `{ traceEvents: [...] }` or `[...]`. */
function eventsOf(trace: unknown): TraceEvent[] {
  const events = Array.isArray(trace)
    ? trace
    : (trace as { traceEvents?: unknown } | null)?.traceEvents;
  if (!Array.isArray(events)) throw new Error("not a trace: no traceEvents array");
  return events.filter((e): e is TraceEvent => typeof e === "object" && e !== null);
}

export interface StartupTimes {
  readyMs: number;
  firstFrameMs: number;
}

/** When the ready line was printed and when the first interactive frame was painted. */
export function startupTimes(trace: unknown): StartupTimes {
  const events = eventsOf(trace);
  const ready = events.find((e) => e.name === READY_LINE && e.ph === "i");
  if (typeof ready?.ts !== "number") throw new Error(`the trace has no "${READY_LINE}"`);
  const frame = events.find((e) => e.name === FIRST_FRAME && e.ph === "X");
  if (typeof frame?.ts !== "number" || typeof frame.dur !== "number") {
    throw new Error(`the trace has no "${FIRST_FRAME}"`);
  }
  return { readyMs: round1(ready.ts / 1000), firstFrameMs: round1((frame.ts + frame.dur) / 1000) };
}

/** When the traced start began (ms since the epoch), if the trace says. */
export function startedAt(trace: unknown): number | undefined {
  if (Array.isArray(trace)) return undefined;
  const started = (trace as { otherData?: { startedAt?: unknown } } | null)?.otherData?.startedAt;
  return typeof started === "number" ? started : undefined;
}

/** The names of the trace's phases, for checking that a start went through all of them. */
export function phaseNames(trace: unknown): string[] {
  return eventsOf(trace)
    .filter((e) => e.ph === "X" && typeof e.name === "string")
    .map((e) => e.name as string);
}
