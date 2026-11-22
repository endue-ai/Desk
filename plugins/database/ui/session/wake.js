// Whether the computer slept since a kept session was last used, and the check a run makes on it
// then (PG-105, ADR 0355). The wall clock goes on while the computer sleeps and the monotonic one
// does not, so the wall clock running ahead of it says a sleep came between; a network change or a
// server restart in that time leaves a session that looks open and never answers. The check is one
// SELECT 1, five seconds at most: any answer but a FATAL one says the session is there. No DOM.

/** How far the wall clock may run ahead of the monotonic one before it counts as a sleep. */
export const SLEPT_MS = 10_000;
/** How long the check waits for its answer. */
export const PROBE_MS = 5000;

/** @typedef {{ wall: number, mono: number }} Mark  When a session was last used, on both clocks. */

/** The monotonic clock of the page, else none (every gap then counts as awake). */
export const monotonic = () => globalThis.performance?.now?.() ?? Number.NaN;

/** Whether a sleep came between `mark` and now. */
export function slept(/** @type {Mark} */ mark, /** @type {Mark} */ now) {
  const ahead = now.wall - mark.wall - (now.mono - mark.mono);
  return Number.isFinite(ahead) && ahead > SLEPT_MS;
}

/**
 * Whether a session answers: SELECT 1 on it, given up after PROBE_MS. Its page's transaction state
 * comes back too, for the keeper to follow.
 * @param {(method: string, params: Record<string, unknown>) => Promise<any>} call
 * @param {string} sessionId
 * @param {{ setTimer(fn: () => void, ms: number): unknown, clearTimer(timer: unknown): void }} timers
 * @returns {Promise<{ alive: boolean, transaction?: import("@endue-ai/bridge").DbTransaction }>}
 */
export async function probe(call, sessionId, timers) {
  /** @type {unknown} */
  let timer;
  const late = new Promise((resolve) => {
    timer = timers.setTimer(() => resolve(undefined), PROBE_MS);
  });
  const asked = call("db.run", { sessionId, sql: "SELECT 1", pageRows: 1 }).catch(() => undefined);
  const page = /** @type {import("@endue-ai/bridge").DbPage | undefined} */ (
    await Promise.race([asked, late])
  );
  timers.clearTimer(timer);
  if (!page || page.error?.severity === "FATAL") return { alive: false };
  return { alive: true, ...(page.transaction ? { transaction: page.transaction } : {}) };
}
