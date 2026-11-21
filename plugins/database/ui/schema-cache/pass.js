// One pass over a PostgreSQL database: the fingerprint statement, then one statement per kind for
// every schema that is to be read, each its own run so progress shows between steps and a cancel
// lands before the next one; the database level's kinds (DATABASE) run only when it is read. The
// number of statements does not grow with the schema: twelve for ten tables or ten thousand. Each
// kind asks for what the server's version has (the fingerprint statement answers it). Everything
// runs through `execute` as the plugin's own reading (`catalog: true`), so it moves with the engine
// to the core's sessions (PG-01c). No DOM.

import { DATABASE } from "./kinds.js";
import { bySchema } from "./model.js";

/**
 * @typedef {import("../engines/common.js").Connection} Connection
 * @typedef {import("./kinds.js").Kind} Kind
 * @typedef {import("./model.js").Row} Row
 * @typedef {(conn: Connection, sql: string, options?: import("../execute.js").ExecuteOptions) => Promise<import("../execute.js").Execution>} Execute
 * @typedef {{ step: number, steps: number, label: string }} Progress
 * @typedef {{ name: string, system: boolean, mark: string }} Listed
 *   DATABASE ("") is the database level, listed after the fingerprints of its kinds.
 * @typedef {{
 *   listed: Listed[], read: Map<string, Record<string, Row[]>>, statements: number,
 * }} PassResult
 *   `listed` is every schema of the server; `read` the rows of each schema read, by kind.
 * @typedef {{
 *   execute: Execute, conn: Connection, kinds: readonly Kind[], marksSql: string, quiet: boolean,
 *   progress(progress: Progress): void, stopped(): boolean,
 * }} PassRun
 */

/** The most rows one statement of a pass may answer; more is an error. */
export const PASS_ROWS = 500_000;
/** The version a kind asks for when the server does not say (a fixture): the newest. */
const NEWEST = 170000;

/** A pass that stopped because the person cancelled it. */
export class Cancelled extends Error {
  constructor() {
    super("Cancelled.");
    this.name = "Cancelled";
  }
}

/**
 * @param {PassRun} run
 * @param {(listed: Listed[]) => string[]} plan Which schemas to read, once the marks are in.
 * @returns {Promise<PassResult>}
 */
export async function runPass(run, plan) {
  const { execute, conn, kinds, quiet } = run;
  const steps = kinds.length + 1;
  let statements = 0;
  /** One statement's rows, or an Error with the client's words. */
  const rowsOf = async (/** @type {string} */ sql) => {
    if (run.stopped()) throw new Cancelled();
    statements++;
    const done = await execute(conn, sql, {
      catalog: true,
      maxRows: PASS_ROWS,
      ...(quiet ? { interactive: false } : {}),
    });
    const { result } = done;
    const error = result.error ?? result.statements[0]?.error;
    if (error?.kind === "cancelled" || run.stopped()) throw new Cancelled();
    if (error) throw Object.assign(new Error(error.message), { kind: error.kind });
    if (!result.statements[0]?.ran) throw new Error("The catalog was not read.");
    const set = result.statements[0]?.sets[0];
    if (set?.truncated)
      throw new Error(
        `More than ${PASS_ROWS.toLocaleString("en")} rows of the catalog: choose fewer schemas (Database: choose the schemas to read).`,
      );
    return set?.rows ?? [];
  };

  run.progress({ step: 1, steps, label: "schemas" });
  const marks = await rowsOf(run.marksSql);
  const version = Number(marks[0]?.[3]) || NEWEST;
  const listed = marks.map(([name, system, mark]) => ({
    name: name ?? "",
    system: system === "s",
    mark: mark ?? "",
  }));
  const wanted = plan(listed);
  /** @type {Map<string, Record<string, Row[]>>} */
  const read = new Map(wanted.map((name) => [name, {}]));
  const schemas = wanted.filter((name) => name !== DATABASE);
  // Steps keep their numbers: a kind with nothing to read is passed over.
  for (const [i, kind] of kinds.entries()) {
    if (kind.level === "database" ? !read.has(DATABASE) : schemas.length === 0) continue;
    run.progress({ step: i + 2, steps, label: kind.label });
    const grouped = bySchema(await rowsOf(kind.sql(schemas, version)));
    for (const [name, data] of read)
      if ((name === DATABASE) === (kind.level === "database"))
        data[kind.id] = grouped.get(name) ?? [];
  }
  return { listed, read, statements };
}
