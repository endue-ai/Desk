// A whole export's job and its panel (PG-64): the panel opens with every file it will write, each
// one's rows and bytes drawn as they grow (a fresh state at most every 150 ms), its status, and the
// end's sentence. Cancel aborts the job's signal: the COPY under way is closed on the server and its
// temporary file goes. No DOM.

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {"waiting" | "running" | "done" | "failed" | "cancelled"} Status
 * @typedef {{ name: string, path: string, rows: number, bytes: number, status: Status, direct?: boolean }} FileState
 * @typedef {{
 *   title: string, format: string, status: Status, files: FileState[], result: string,
 *   started: number, ended: number | null,
 * }} JobState
 */

export const TYPE = "export-all";
const EVERY_MS = 150;

/** @param {Pick<Deps, "consoles">} deps @param {{ now?(): number }} [clock] */
export function createJobs(deps, clock = {}) {
  const now = clock.now ?? (() => Date.now());
  /** @type {Map<string, AbortController>} by panel id */
  const controllers = new Map();
  return {
    /**
     * Open a job's panel.
     * @param {Connection} conn
     * @param {string} name The panel's.
     * @param {Omit<JobState, "status" | "result" | "started" | "ended">} fields
     */
    async start(conn, name, fields) {
      /** @type {JobState} */
      let state = { ...fields, status: "running", result: "", started: now(), ended: null };
      const panel = await deps.consoles.openPanel(conn, TYPE, `export: ${name}`, state);
      const id = panel.id;
      const control = new AbortController();
      controllers.set(id, control);
      /** @type {ReturnType<typeof setTimeout> | undefined} */
      let timer;
      const draw = () => {
        timer = undefined;
        deps.consoles.updatePanel(id, state);
      };
      return {
        id,
        signal: control.signal,
        /** A file's progress or status; drawn soon. */
        file(/** @type {number} */ at, /** @type {Partial<FileState>} */ patch) {
          state = {
            ...state,
            files: state.files.map((f, i) => (i === at ? { ...f, ...patch } : f)),
          };
          timer ??= setTimeout(draw, EVERY_MS);
        },
        /** The end: drawn at once. */
        end(/** @type {Status} */ status, /** @type {string} */ result) {
          controllers.delete(id);
          if (timer !== undefined) clearTimeout(timer);
          timer = undefined;
          state = { ...state, status, result, ended: now() };
          deps.consoles.updatePanel(id, state);
          return state;
        },
      };
    },
    /** Cancel a job by its panel; false when it is not running. */
    cancel(/** @type {string} */ id) {
      const control = controllers.get(id);
      if (!control) return false;
      control.abort();
      return true;
    },
    /** The panels of the jobs that run. */
    running: () => [...controllers.keys()],
  };
}
