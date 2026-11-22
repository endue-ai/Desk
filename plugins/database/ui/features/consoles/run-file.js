// Database: run a .sql file (ADR 0286): a script of any size runs from its file in a console,
// never loaded into the editor. It is read a range at a time (fs.read with an offset, as bytes, so
// a range may cut a character), cut as the console cuts a script, and run part by part
// (script-parts.js), each part a console run under every guard of one (read-only, production,
// dangerous statements). A progress line follows; the first error stops it, named by its line in
// the file, and nothing after it runs. The console shows what came of the file, not its rows. No DOM.

import { readScope, withGrant } from "../../console-files.js";
import { baseName } from "../../console-list.js";
import { engineOf } from "../../engines/index.js";
import { formatCount, formatDuration } from "../../format.js";
import { errorText } from "../../tabs.js";
import { createParts, createScriptReader } from "./script-parts.js";

/**
 * @typedef {import("../../feature-host.js").Deps} Deps
 * @typedef {import("../../consoles.js").Console} Console
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {import("./script-parts.js").Part} Part
 * @typedef {{ line: number, text: string, detail?: string }} Failure
 * @typedef {{ skip(text: string): string | undefined, note(names: string[]): string }} Skips
 *   a statement `skip` names is left out before it runs; the result ends with `note` of the names.
 */

/** A range read at once, in bytes. */
const RANGE = 256 * 1024;
/** What a part may hold: below the argument room a client gets on every desktop system. */
const PART = { bytes: 192 * 1024, statements: 1500, max: 448 * 1024, most: 3000 };

const bytesOf = (/** @type {string} */ base64) =>
  Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

/** The console a file runs in, with its connection: the one on screen, else one picked. */
async function consoleFor(
  /** @type {Deps} */ deps,
  /** @type {Record<string, unknown>} */ args,
  /** @type {string} */ name,
) {
  const ref = typeof args.connection === "string" ? args.connection : undefined;
  const title = `Database: run ${name} on which connection?`;
  const shown = deps.consoles.current();
  if (shown?.kind === "console" && !ref) {
    const conn = deps.manager.get(shown.connection);
    if (conn) return { target: shown, conn };
    if (shown.file) {
      const picked = await deps.manager.choose(undefined, title);
      if (!picked) throw deps.cancelled("Not run: pick the connection it runs on.");
      await deps.consoles.bind(shown, picked);
      return { target: shown, conn: picked };
    }
  }
  const conn = await deps.manager.choose(ref, title);
  if (!conn) throw deps.cancelled("Not run: pick the connection it runs on.");
  return { target: await deps.consoles.open(conn), conn };
}

/**
 * Run a .sql file from disk: `path`, else the file of the console on screen, else one named.
 * @param {Deps} deps
 * @param {Record<string, unknown>} args
 * @param {Skips} [skips] what a restore of a plain dump leaves out (features/backup/, #647)
 */
export async function runFile(deps, args, skips) {
  const shown = deps.consoles.current();
  const path =
    (typeof args.path === "string" && args.path) ||
    shown?.file?.path ||
    (await deps.pick("Database: run which .sql file?", [], true, "~/queries/report.sql"));
  if (!path) throw deps.cancelled("Not run.");
  const name = baseName(path);
  const { target, conn } = await consoleFor(deps, args, name);
  if (target.running || target.filing)
    throw new Error("A run is going on in this console: cancel it first.");
  const dialect = engineOf(conn.engine).dialect;
  const reader = createScriptReader(dialect);
  const parts = createParts({ dialect, ...PART });
  const decoder = new TextDecoder();
  const scope = readScope(path);
  const started = Date.now();
  let offset = 0;
  let size = 0;
  let total = 0;
  let line = 1;
  /** @type {Failure | null} */
  let failure = null;
  /** @type {Set<string>} */
  const skipped = new Set();

  /** Run one part; a failure stops the file. */
  const run = async (/** @type {Part} */ part) => {
    const sql = part.statements.map((s) => s.text).join(";\n");
    const options = { statements: part.statements, history: false, file: true };
    line = part.statements[part.replayed]?.line ?? line;
    await deps.consoles.runIn(target, conn, sql, options);
    const execution = /** @type {import("../../execute.js").Execution} */ (target.execution);
    const outcomes = execution.result.statements;
    total += outcomes.slice(part.replayed).filter((o) => o.ran && !o.error).length;
    const at = outcomes.findIndex((o) => o.error);
    const error = at >= 0 ? outcomes[at]?.error : execution.result.error;
    const statement = part.statements[at >= 0 ? at : part.replayed];
    line = statement?.line ?? line;
    if (!error) {
      line = part.statements.at(-1)?.line ?? line;
      const done = size ? Math.min(99, Math.floor((offset / size) * 100)) : 0;
      deps.say(
        `${name}: ${formatCount(total)} statements run · line ${formatCount(line)} · ${done}%`,
      );
      return;
    }
    failure = { line, text: errorText(error), ...(error.detail ? { detail: error.detail } : {}) };
  };
  const runAll = async (/** @type {Part[]} */ list) => {
    for (const part of list) if (!failure) await run(part);
  };

  target.filing = true;
  deps.consoles.render();
  try {
    while (!failure) {
      const call = () =>
        deps.bridge.call("fs.read", { path, offset, length: RANGE, encoding: "base64", scope });
      const got = await withGrant(deps.bridge, scope, call, `To run ${name} in Database`);
      const bytes = bytesOf(got.content);
      offset += bytes.length;
      size = got.size ?? size;
      const last = bytes.length < RANGE || (size > 0 && offset >= size);
      const text = decoder.decode(bytes, { stream: !last });
      try {
        const statements = [...reader.push(text), ...(last ? reader.end() : [])];
        for (const statement of statements) {
          if (failure) break;
          const left = skips?.skip(statement.text);
          if (left) skipped.add(left);
          else await runAll(parts.add(statement));
        }
        if (last && !failure) await runAll(parts.end());
      } catch (error) {
        if (/** @type {{ code?: string }} */ (error)?.code === "cancelled") throw error;
        failure = { line, text: error instanceof Error ? error.message : String(error) };
      }
      if (last) break;
    }
  } finally {
    target.filing = false;
  }
  const fail = /** @type {Failure | null} */ (failure);
  const said = fail
    ? `${name}: stopped at line ${formatCount(fail.line)}: ${fail.text}`
    : `${name}: done, ${formatCount(total)} statements in ${formatDuration(Date.now() - started)}${
        skips && skipped.size ? `; ${skips.note([...skipped])}` : ""
      }`;
  const lines = [
    { level: /** @type {const} */ (fail ? "error" : "ok"), text: said, statement: -1 },
    ...(fail?.detail
      ? [{ level: /** @type {const} */ ("error"), text: fail.detail, statement: -1 }]
      : []),
  ];
  Object.assign(target, {
    shown: {
      tabs: [{ label: "Messages", kind: "messages", statement: -1, lines }],
      open: 0,
      summary: said,
    },
    tab: 0,
    execution: null,
    page: null,
    edit: null,
  });
  deps.consoles.render();
  deps.say(said);
  return said;
}
