// What the import wizard starts on a PostgreSQL connection (PG-60): the sample of the file's first
// bytes (in the import's reader), the server's check of its first rows (copied into a temporary
// table in a transaction that always rolls back, so the person sees them as the server reads them,
// or the server's error), and the import itself (run.js): asked once on a production connection,
// refused on a read-only one, skip mode's reject file placed with the save dialog. Each runs on a
// session of its own, closed after. No DOM.

import { readScope, withGrant } from "../console-files.js";
import { baseName } from "../console-list.js";
import { copyIn, fileSink, fileSource } from "../copy/index.js";
import { t as messageText } from "../strings/index.js";
import { createReader } from "./client.js";
import { createTable } from "./infer.js";
import { createRejects } from "./rejects.js";
import { runCopy } from "./run.js";
import { SAMPLE_BYTES } from "./sample.js";
import { createRows } from "./source.js";
import { copyStatements, jobOf, readOptions } from "./wizard.js";

/**
 * @typedef {import("../engines/common.js").Connection} Connection
 * @typedef {import("./wizard.js").CopyState} CopyState
 * @typedef {import("./source.js").Progress} Progress
 * @typedef {{
 *   bridge: Pick<import("@endue-ai/plugin-sdk").PluginBridge, "call">,
 *   execute: import("../copy/index.js").Execute,
 *   confirm(title: string, reasons: string[]): Promise<boolean>,
 *   settings(): { confirm: boolean },
 *   forget(owner: string): void,
 *   startWorker?: import("./client.js").StartWorker,
 *   xlsx?: import("./transform.js").XlsxReader,
 * }} Deps
 * @typedef {{ size: number, data: string, whole: boolean }} Head The file's first bytes, base64.
 * @typedef {{ conn: Connection, path: string, state: CopyState, header: boolean, keys: string[],
 *   table: string, columns: Array<{ name: string, from: number }> }} Target
 */

/** The rows the server's check reads back. */
export const CHECK_ROWS = 20;
const CHECK_TABLE = "desk_import_check";

/** The largest `.xlsx` an import reads: a workbook is a ZIP, read whole. */
export const XLSX_MAX = 64 * 1024 * 1024;

/**
 * The first bytes of the file at `path` (all of an `.xlsx`), and its size, under its read grant.
 * @param {Deps["bridge"]} bridge
 * @param {string} path
 * @param {boolean} [whole] Read it all (an `.xlsx`), up to XLSX_MAX.
 * @returns {Promise<Head>}
 */
export async function headOf(bridge, path, whole = false) {
  const scope = readScope(path);
  const length = whole ? XLSX_MAX + 1 : SAMPLE_BYTES;
  const read = await withGrant(
    bridge,
    scope,
    () => bridge.call("fs.read", { path, offset: 0, length, encoding: "base64", scope }),
    `To open ${baseName(path)} in Database`,
  );
  if (read.encoding === "base64") {
    const pad = read.content.match(/=*$/u)?.[0].length ?? 0;
    const bytes = Math.floor((read.content.length * 3) / 4) - pad;
    const size = read.size ?? bytes;
    if (whole && size > XLSX_MAX)
      throw new Error(
        messageText("importCopy.start.isLargerThanMibTheMost", {
          value: String(baseName(path)),
          value2: String(XLSX_MAX / 1024 / 1024),
        }),
      );
    return { size, data: read.content, whole: bytes >= size };
  }
  // A host that answers text (the unit tests' files): the whole file, as UTF-8.
  const bytes = new TextEncoder().encode(read.content);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { size: read.size ?? bytes.length, data: btoa(binary), whole: true };
}

/** A file whole as UTF-8 text, for the INSERT import of the other engines. */
export async function textOf(/** @type {Deps["bridge"]} */ bridge, /** @type {string} */ path) {
  const scope = readScope(path);
  const read = await withGrant(
    bridge,
    scope,
    () => bridge.call("fs.read", { path, encoding: "utf8", scope }),
    `To open ${baseName(path)} in Database`,
  );
  return read.content;
}

/** @param {Deps} deps */
export function createCopyStarts(deps) {
  let seq = 0;
  const reader = () =>
    createReader({
      ...(deps.startWorker ? { startWorker: deps.startWorker } : {}),
      ...(deps.xlsx ? { xlsx: deps.xlsx } : {}),
    });
  /** The file's rows through a reader of their own. */
  const rowsOf = async (/** @type {Target} */ t, /** @type {(p: Progress) => void} */ progress) => {
    const read = reader();
    await read.open(jobOf(t.state, t.header, t.keys, t.columns));
    const file = await fileSource(deps.bridge, t.path);
    return { read, rows: createRows({ file, reader: read, progress }) };
  };
  const owner = (/** @type {string} */ what) =>
    /** @type {import("../session/keeper.js").Owner} */ ({
      owner: `import:${what}:${++seq}`,
      kind: "console",
    });

  return {
    /** The records of the file's first bytes, read with the wizard's options. */
    async sample(
      /** @type {CopyState} */ state,
      /** @type {boolean} */ header,
      /** @type {Head} */ head,
    ) {
      const read = reader();
      try {
        return await read.sample(readOptions(state, header), head.data, head.whole);
      } finally {
        read.close();
      }
    },

    /**
     * The first rows as the server reads them, or its error.
     * @param {Target} t
     * @returns {Promise<{ columns: string[], rows: (string | null)[][] } | { error: string }>}
     */
    async check(t) {
      const planned = copyStatements(t.state, CHECK_TABLE, t.columns);
      if ("problem" in planned) return { error: planned.problem ?? "" };
      const made =
        t.state.target === "new"
          ? createTable(CHECK_TABLE, t.state.newColumns)
          : { sql: `CREATE TABLE ${CHECK_TABLE} (LIKE ${t.table} INCLUDING DEFAULTS)` };
      if ("problem" in made) return { error: made.problem };
      const who = owner("check");
      const on = { session: who, asked: true };
      const { read, rows } = await rowsOf(t, () => {});
      /** @param {string} sql */
      const run = async (sql) => {
        const done = await deps.execute(t.conn, sql, on);
        const error = done.result.error ?? done.result.statements.find((s) => s.error)?.error;
        if (error) throw new Error(error.message);
        return done;
      };
      try {
        await run("BEGIN");
        for (const sql of planned.begin ?? []) await run(sql);
        await run(made.sql.replace(/^CREATE TABLE/u, "CREATE TEMPORARY TABLE"));
        const copied = await copyIn(
          deps.execute,
          t.conn,
          planned.copy ?? "",
          rows.batch(CHECK_ROWS),
          on,
        );
        const failed = copied.result.statements.find((s) => s.error)?.error ?? copied.result.error;
        if (failed) return { error: failed.message };
        const names = t.columns.map((c) => `"${c.name.replaceAll('"', '""')}"`).join(", ");
        const got = await run(`SELECT ${names} FROM ${CHECK_TABLE}`);
        const set = got.result.statements[0]?.sets[0];
        return { columns: set?.columns ?? [], rows: set?.rows ?? [] };
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      } finally {
        await deps.execute(t.conn, "ROLLBACK", on).catch(() => {});
        read.close();
        deps.forget(who.owner);
      }
    },

    /**
     * Import the whole file.
     * @param {Target & { signal: AbortSignal, progress(p: Progress): void }} t
     */
    async run(t) {
      if (t.conn.readOnly)
        throw new Error(
          messageText("importCopy.start.isReadOnlyAnImportChanges", { name: String(t.conn.name) }),
        );
      const planned = copyStatements(t.state, t.table, t.columns);
      if ("problem" in planned) throw new Error(planned.problem);
      if (t.conn.tag === "production" && deps.settings().confirm) {
        const reasons = [
          messageText("importCopy.start.isTaggedProduction", { name: String(t.conn.name) }),
          ...(planned.create ? [planned.create.replace(/\s+/gu, " ")] : []),
          planned.copy ?? "",
        ];
        if (
          !(await deps.confirm(
            messageText("importCopy.start.importOn", {
              value: String(baseName(t.path)),
              name: String(t.conn.name),
            }),
            reasons,
          ))
        )
          return undefined;
      }
      let rejects;
      if (t.state.onError === "skip") {
        const name = baseName(t.path).replace(/\.[^.]*$/u, "");
        const chosen = await deps.bridge.call("dialog.save", {
          title: messageText("importCopy.start.whereTheRowsRefusesGo", {
            name: String(t.conn.name),
          }),
          suggestedName: `${name}.rejects.csv`,
          filters: [{ name: "CSV", extensions: ["csv"] }],
        });
        if (chosen.cancelled || !chosen.path) return undefined;
        rejects = createRejects(
          fileSink(deps.bridge, chosen.path),
          t.columns.map((c) => c.name),
        );
      }
      const { read, rows } = await rowsOf(t, t.progress);
      try {
        return await runCopy({
          execute: deps.execute,
          conn: t.conn,
          owner: owner("run"),
          signal: t.signal,
          begin: planned.begin ?? [],
          ...(planned.create ? { create: planned.create } : {}),
          copy: planned.copy ?? "",
          rows,
          batch: t.state.batch,
          ...(rejects ? { rejects } : {}),
          forget: deps.forget,
        });
      } finally {
        read.close();
      }
    },
  };
}
