// PostgreSQL's COPY through the session as a call the plugin's parts share (PG-23): a file import
// (PG-60), a copy between databases (PG-63) and a whole table to a file (PG-64) run their COPY
// ... TO STDOUT into a sink and their COPY ... FROM STDIN from a source through `deps.execute`, so
// the read-only, production and agent guards, the console's session and Cancel all hold. A sink or
// a source is any object with `write` or `read` (stream.js); files.js makes them of a file. No DOM.

export { fileSink, fileSource } from "./files.js";
export { COPY_CHUNK } from "./stream.js";

/**
 * @typedef {import("./stream.js").Sink} Sink
 * @typedef {import("./stream.js").Source} Source
 * @typedef {import("./stream.js").Progress} Progress
 * @typedef {import("../engines/common.js").Connection} Connection
 * @typedef {import("../execute.js").ExecuteOptions} ExecuteOptions
 * @typedef {(conn: Connection, sql: string, options?: ExecuteOptions) => Promise<import("../execute.js").Execution>} Execute
 * @typedef {Omit<ExecuteOptions, "copy"> & { name?: string, progress?(p: Progress | null): void }} CopyOptions
 *   `name` is the file's, which a failed row's error names; `progress` hears the bytes.
 */

/** The parts of the options a run's copy takes. */
const split = (/** @type {CopyOptions} */ options) => {
  const { name, progress, ...rest } = options;
  return { rest, own: { ...(name ? { name } : {}), ...(progress ? { progress } : {}) } };
};

/**
 * Run `sql`, a COPY ... TO STDOUT, with its rows going to `sink`; answers the run (its outcome has
 * the COPY's row count, or its error).
 * @param {Execute} execute
 * @param {Connection} conn
 * @param {string} sql
 * @param {Sink} sink
 * @param {CopyOptions} [options]
 */
export function copyOut(execute, conn, sql, sink, options = {}) {
  const { rest, own } = split(options);
  return execute(conn, sql, { ...rest, copy: { sink, ...own } });
}

/**
 * Run `sql`, a COPY ... FROM STDIN, with its rows read from `source`; answers the run.
 * @param {Execute} execute
 * @param {Connection} conn
 * @param {string} sql
 * @param {Source} source
 * @param {CopyOptions} [options]
 */
export function copyIn(execute, conn, sql, source, options = {}) {
  const { rest, own } = split(options);
  return execute(conn, sql, { ...rest, copy: { source, ...own } });
}
