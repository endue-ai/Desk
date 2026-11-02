/**
 * Start-up phases as User Timing measures named `desk:<phase>`. The app hands them to its start-up
 * trace when `DESK_TRACE` is on (crates/desk-trace, apps/desk/src/startup.ts); otherwise each one
 * is an entry in the page's performance timeline and nothing more. A phase named `mount <plugin>`
 * is that plugin's mount.
 */

/** The prefix that tells the desk's measures from anyone else's. */
export const PHASE_PREFIX = "desk:";

/** A phase as the app's trace takes it: ms from the page's time origin. */
export interface Phase {
  name: string;
  start: number;
  duration: number;
}

/** Now on the page's clock (ms from its time origin). */
export const now = (): number => performance.now();

/** Record the phase `name` from `start` to `end` (ms from the time origin). Never throws. */
export function phase(name: string, start: number, end: number = now()): void {
  try {
    performance.measure(`${PHASE_PREFIX}${name}`, { start, end });
  } catch {
    // A timeline without User Timing measures records nothing; the desk runs on.
  }
}

/** Run `work` and record it as the phase `name`, whether it resolves or rejects. */
export async function timed<T>(name: string, work: () => Promise<T>): Promise<T> {
  const start = now();
  try {
    return await work();
  } finally {
    phase(name, start);
  }
}

/** The desk's phases so far, by start. */
export function phases(): Phase[] {
  return performance
    .getEntriesByType("measure")
    .filter((entry) => entry.name.startsWith(PHASE_PREFIX))
    .map((entry) => ({
      name: entry.name.slice(PHASE_PREFIX.length),
      start: entry.startTime,
      duration: entry.duration,
    }));
}
