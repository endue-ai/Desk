// A console's notices as they are raised (PG-25, ADR 0358): while its run goes on, each
// db.call.notice of its session is a line here, in the order they came, so a long routine's
// progress shows before its answer. At the run's end the lines go: the run's Messages show the
// notices from its pages, each on its statement (ADR 0334). A run keeps its latest LIVE lines and
// counts the rest. No DOM.

/** The lines a run shows while it goes on. */
export const LIVE = 2000;

export function createRaised() {
  /** The lines of each owner's run that goes on. @type {Map<string, { lines: string[], dropped: number }>} */
  const runs = new Map();
  return {
    /** The owner's run starts: what it hears goes here. */
    start: (/** @type {string} */ owner) => runs.set(owner, { lines: [], dropped: 0 }),
    /** A notice the owner's running call heard, as its lines; false when no run of it goes on. */
    add(/** @type {string} */ owner, /** @type {string[]} */ lines) {
      const run = runs.get(owner);
      if (!run) return false;
      run.lines.push(...lines);
      const over = run.lines.length - LIVE;
      if (over > 0) {
        run.lines.splice(0, over);
        run.dropped += over;
      }
      return true;
    },
    /** The owner's run ended. */
    end: (/** @type {string} */ owner) => runs.delete(owner),
    /** The lines heard so far, once there is one. */
    model(/** @type {string} */ owner) {
      const run = runs.get(owner);
      return run && (run.lines.length || run.dropped) ? run : undefined;
    },
  };
}
