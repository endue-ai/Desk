// A pg_dump or pg_restore run in its log panel (features/README.md): the panel opens with the exact
// command line, its verbose lines are drawn as they come (a fresh state at most every 150 ms, the
// last 1,000 lines kept), what it got through is counted from them, and the end says what came of
// it. Cancel aborts the run's own signal: the runner sends SIGINT, then SIGKILL a second later. One
// run per panel name at a time. No DOM.

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {import("../../engines/common.js").Invocation} Invocation
 * @typedef {import("../../engines/common.js").Outcome} Outcome
 * @typedef {"running" | "done" | "failed" | "cancelled"} Status
 * @typedef {{
 *   kind: "backup" | "restore", title: string, command: string, password: string,
 *   status: Status, lines: string[], dropped: number, done: number, total: number | null,
 *   noun: string, started: number, ended: number | null, result: string,
 * }} LogState
 *   `password` says where the password comes from (never the password); `dropped` counts the lines
 *   no longer kept; `done` of `total` (null: not known) what the run got through, in `noun`s.
 * @typedef {{
 *   conn: Connection, name: string, state: LogState, invocation: Invocation,
 *   counts(line: string): boolean,
 *   finish(outcome: Outcome, state: LogState): Promise<{ status: Status, result: string }>,
 * }} Spec
 */

export const TYPE = "backup";
export const LINES_MAX = 1000;
const EVERY_MS = 150;

/** A fresh log's state. */
export function logState(
  /** @type {Pick<LogState, "kind" | "title" | "command" | "password" | "noun"> & { total?: number | null }} */ fields,
  /** @type {number} */ at,
) {
  /** @type {LogState} */
  const state = {
    total: null,
    ...fields,
    status: "running",
    lines: [],
    dropped: 0,
    done: 0,
    started: at,
    ended: null,
    result: "",
  };
  return state;
}

/** The state with `lines` added at the end, the oldest past the limit dropped. */
export function appended(
  /** @type {LogState} */ state,
  /** @type {string[]} */ lines,
  /** @type {(line: string) => boolean} */ counts,
) {
  const all = [...state.lines, ...lines];
  const over = Math.max(0, all.length - LINES_MAX);
  const done = state.done + lines.filter(counts).length;
  return {
    ...state,
    lines: over ? all.slice(over) : all,
    dropped: state.dropped + over,
    done: state.total === null ? done : Math.min(done, state.total),
  };
}

/**
 * @param {Pick<Deps, "consoles" | "runner">} deps
 * @param {{ now?(): number, setTimer?(fn: () => void, ms: number): unknown, clearTimer?(t: unknown): void }} [clock]
 */
export function createJobs(deps, clock = {}) {
  const now = clock.now ?? (() => Date.now());
  const setTimer = clock.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer =
    clock.clearTimer ?? ((t) => clearTimeout(/** @type {ReturnType<typeof setTimeout>} */ (t)));
  /** @type {Map<string, AbortController>} by panel id */
  const controllers = new Map();
  const panels = () => deps.consoles.list().filter((b) => b.kind === TYPE);

  /** Run a program in its panel; resolves with the last state once it ended. */
  const run = async (/** @type {Spec} */ spec) => {
    const open = panels().find((b) => b.name === spec.name && controllers.has(b.id));
    if (open) throw new Error(`${spec.name} is still running: cancel it first.`);
    const panel = await deps.consoles.openPanel(spec.conn, TYPE, spec.name, spec.state);
    const id = panel.id;
    const control = new AbortController();
    controllers.set(id, control);
    let state = spec.state;
    /** @type {unknown} */
    let timer;
    const partial = { stdout: "", stderr: "" };
    const draw = () => {
      timer = undefined;
      deps.consoles.updatePanel(id, state);
    };
    const heard = (/** @type {"stdout" | "stderr"} */ stream, /** @type {string} */ text) => {
      const parts = (partial[stream] + text).split("\n");
      partial[stream] = parts.pop() ?? "";
      const lines = parts.map((l) => l.replace(/\r$/u, "")).filter((l) => l !== "");
      if (lines.length === 0) return;
      state = appended(state, lines, spec.counts);
      timer ??= setTimer(draw, EVERY_MS);
    };
    try {
      const outcome = await deps.runner.run(spec.invocation, {
        signal: control.signal,
        onOutput: heard,
      });
      const rest = [partial.stdout, partial.stderr].filter((l) => l.trim() !== "");
      if (rest.length) state = appended(state, rest, spec.counts);
      state = { ...state, ...(await spec.finish(outcome, state)), ended: now() };
    } catch (error) {
      const result = error instanceof Error ? error.message : String(error);
      state = { ...state, status: "failed", result, ended: now() };
    } finally {
      controllers.delete(id);
      if (timer !== undefined) clearTimer(timer);
      deps.consoles.updatePanel(id, state);
    }
    return state;
  };

  return {
    run,
    /** Cancel a panel's run; false when it runs nothing. */
    cancel(/** @type {string} */ id) {
      const control = controllers.get(id);
      control?.abort();
      return control !== undefined;
    },
    /** The panels whose program runs now. */
    running: () => panels().filter((b) => controllers.has(b.id)),
  };
}
