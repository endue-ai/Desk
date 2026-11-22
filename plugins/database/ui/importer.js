// The import wizard (DB-23), without the DOM: a dropped CSV, TSV or JSON file goes into a table of a
// connection. It reads the file's columns, maps them to the table's by name (the person changes any
// of it), previews the first rows as they will be inserted, then runs every INSERT in one
// transaction through the executor, so read-only connections refuse, production asks, and the first
// failure keeps nothing. On PostgreSQL a file of any size, JSON lines and .xlsx included, goes in by
// COPY instead, into the table or a new one (import-copy/branch.js, PG-60). The view draws the model;
// its controls come back here by name.

import { defaultSchema, tableName } from "./catalog.js";
import { RESERVED } from "./editor/words.js";
import { engineOf } from "./engines/index.js";
import { autoMap, importStatements, readTable } from "./import.js";
import { createCopyBranch } from "./import-copy/branch.js";
import { createCopyStarts } from "./import-copy/start.js";
import { changeCopy } from "./import-copy/wizard.js";
import { readableName } from "./sql/quote.js";
import { split } from "./sql/split.js";

/**
 * @typedef {import("./engines/common.js").Connection} Connection
 * @typedef {import("./catalog.js").Column} Column
 * @typedef {import("./import-copy/wizard.js").CopyFormat} Format
 * @typedef {import("./import.js").Table} Table
 * @typedef {{
 *   file: string, format: Format, header: boolean, emptyNull: boolean,
 *   connection: string, connections: Array<{ id: string, name: string }>,
 *   schema: string, schemas: string[], table: string, tables: string[],
 *   columns: Array<{ name: string, type: string }>, fileColumns: string[], examples: (string | null)[],
 *   mapping: (string | null)[], rows: number, preview: Table, statements: number, sql: string,
 *   problem: string, running: boolean,
 *   copy?: ReturnType<typeof import("./import-copy/wizard.js").copyModel>,
 * }} ImportModel
 *   `copy` is there on a PostgreSQL connection, which imports by COPY.
 * @typedef {{ connection?: string, schema?: string, table?: string }} Into
 * @typedef {{ header?: boolean, empty?: boolean, connection?: string, schema?: string,
 *   table?: string, map?: [number, string | null] } & import("./import-copy/wizard.js").CopyChange} Change
 * @typedef {{
 *   manager: { list(): Connection[], get(id: string): Connection | undefined },
 *   catalog: Pick<ReturnType<typeof import("./catalog.js").createCatalog>, "schemas" | "objects" | "columns">,
 *   execute(conn: Connection, sql: string, options?: import("./execute.js").ExecuteOptions): Promise<import("./execute.js").Execution>,
 *   current(): { connection: string, table: { schema: string, name: string } | null } | null,
 *   view: { importer(model: ImportModel | null): void, say(text: string): void },
 *   copies: import("./import-copy/start.js").Deps,
 *   readText(path: string): Promise<string>,
 * }} Deps
 *   `copies` runs a PostgreSQL import (import-copy/start.js); `readText` reads a file whole for the
 *   INSERT import.
 */

const PREVIEW_ROWS = 5;
/** The largest file the INSERT import reads whole. */
const WHOLE_MAX = 16 * 1024 * 1024;
const isPg = (/** @type {Connection | undefined} */ conn) => conn?.engine === "postgresql";
const SQL_SHOWN = 2000;
const messageOf = (/** @type {unknown} */ error) =>
  error instanceof Error ? error.message : String(error);

/** @param {Deps} deps */
export function createImporter(deps) {
  /** @type {null | import("./import-copy/branch.js").Held & { text: string | undefined,
   *   emptyNull: boolean, connection: string, schemas: string[], tables: string[],
   *   columns: Column[], pg: boolean }} */
  let s = null;
  let reads = 0;
  const copies = createCopyBranch(createCopyStarts(deps.copies));

  /** The file as the options read it: the header line or not, a CSV's empty fields NULL or ''. */
  const reparse = async () => {
    if (!s) return;
    s.pg = isPg(deps.manager.get(s.connection));
    if (s.pg) {
      await copies.reparse(s);
      return;
    }
    try {
      if (s.format === "xlsx" || s.format === "jsonl")
        throw new Error(
          "Only a PostgreSQL connection imports JSON lines and .xlsx files (by COPY).",
        );
      if (s.text === undefined) {
        if (s.head.size > WHOLE_MAX)
          throw new Error(
            `${s.file} is larger than ${WHOLE_MAX / 1024 / 1024} MiB: a PostgreSQL connection imports it by COPY.`,
          );
        s.text = await deps.readText(s.path);
      }
      const table = readTable(s.text, s.format, { header: s.header });
      const rows =
        s.format === "csv" && !s.emptyNull
          ? table.rows.map((row) => row.map((v) => v ?? ""))
          : table.rows;
      s.data = { columns: table.columns, rows };
      s.unreadable = "";
    } catch (error) {
      s.data = { columns: [], rows: [] };
      s.unreadable = messageOf(error);
    }
  };

  /** The tables of the connection's schema, the one to import into, and its columns. */
  const load = async (/** @type {Connection} */ conn, /** @type {Into} */ want) => {
    if (!s) return;
    const seq = ++reads;
    const file = s.file.replace(/\.[^.]*$/u, "").toLowerCase();
    try {
      const schemas = await deps.catalog.schemas(conn);
      const fallback = defaultSchema(conn);
      const schema =
        want.schema && (schemas.length === 0 || schemas.includes(want.schema))
          ? want.schema
          : schemas.includes(fallback) || schemas.length === 0
            ? fallback
            : (schemas[0] ?? fallback);
      const objects = await deps.catalog.objects(conn, schema);
      const tables = objects.filter((o) => o.kind === "table").map((o) => o.name);
      const shown = deps.current();
      const onScreen = shown?.connection === conn.id ? shown.table?.name : undefined;
      const table =
        (want.table && tables.includes(want.table) ? want.table : undefined) ??
        tables.find((t) => t.toLowerCase() === file) ??
        (onScreen && tables.includes(onScreen) ? onScreen : undefined) ??
        // A COPY makes a new table instead of guessing the only one (PG-60).
        (tables.length === 1 && !s.copy ? (tables[0] ?? "") : "");
      const columns = table ? await deps.catalog.columns(conn, schema, table) : [];
      if (seq !== reads || !s) return;
      Object.assign(s, { connection: conn.id, schemas, schema, tables, table, columns });
      if (s.pg !== isPg(conn)) await reparse();
      if (!s) return;
      s.mapping = autoMap(s.data.columns, columns);
    } catch (error) {
      if (seq === reads && s) s.problem = messageOf(error);
    }
  };

  /** What the view draws, and the statements an import would run. */
  const plan = () => {
    if (!s) return null;
    const conn = deps.manager.get(s.connection);
    const dialect = conn ? engineOf(conn.engine).dialect : "postgresql";
    const { columns: fileColumns, rows } = s.data;
    const copy = conn && s.pg && s.copy ? copies.plan(s, conn) : undefined;
    const used = copy
      ? copy.columns.map((c) => ({ name: c.name, type: "" }))
      : s.columns.filter((c) => s?.mapping.includes(c.name));
    const from = copy
      ? copy.columns.map((c) => c.from)
      : used.map((c) => s?.mapping.indexOf(c.name) ?? -1);
    /** @type {string[]} */
    let statements = [];
    let problem = copy ? copy.problem : s.unreadable || s.problem;
    if (copy) {
      // A COPY makes no INSERTs: its own problem holds Import back.
    } else if (!problem && !conn) problem = "That connection is gone.";
    else if (!problem && !s.table) problem = "Pick the table to import into.";
    else if (!problem && rows.length === 0) problem = "The file holds no rows.";
    else if (!problem && used.length === 0) problem = "Map at least one column to the table.";
    if (!problem && conn && !copy)
      try {
        const table = tableName(conn, s.schema, s.table);
        statements = importStatements({
          dialect,
          table,
          columns: s.columns,
          mapping: s.mapping,
          rows,
        });
      } catch (error) {
        problem = messageOf(error);
      }
    /** @type {ImportModel} */
    const model = {
      file: s.file,
      format: s.format,
      header: s.header,
      emptyNull: s.emptyNull,
      connection: s.connection,
      connections: deps.manager.list().map(({ id, name }) => ({ id, name })),
      schema: s.schema,
      schemas: s.schemas,
      table: s.table,
      tables: s.tables,
      columns: s.columns.map(({ name, type }) => ({ name, type })),
      fileColumns,
      examples: fileColumns.map((_, i) => rows[0]?.[i] ?? null),
      mapping: [...s.mapping],
      rows: rows.length,
      preview: {
        columns: used.map((c) => c.name),
        rows: rows.slice(0, PREVIEW_ROWS).map((row) => from.map((i) => row[i] ?? null)),
      },
      statements: statements.length,
      sql: (copy ? copy.sql : (statements[0] ?? "")).slice(0, SQL_SHOWN),
      problem,
      running: s.running,
      ...(copy ? { copy: copy.copy } : {}),
    };
    return { model, statements, conn, dialect };
  };

  const publish = () => deps.view.importer(plan()?.model ?? null);

  /** The table's name as the person reads it, for the words said after a run. */
  const named = (/** @type {Connection} */ conn) => {
    const { dialect } = engineOf(conn.engine);
    const schema = conn.engine === "sqlite" ? "" : (s?.schema ?? "");
    return readableName(dialect, schema, s?.table ?? "", RESERVED);
  };

  /** The COPY import; the wizard closes when it is done, and stays with the problem when not. */
  const copyRun = async (/** @type {Connection} */ conn) => {
    if (!s) return undefined;
    const held = s;
    held.running = true;
    publish();
    const done = await copies.run(held, conn, publish);
    held.running = false;
    if (s !== held) return done?.message;
    if (!done) {
      publish();
      return undefined;
    }
    if (done.ok) s = null;
    else held.problem = done.message;
    publish();
    deps.view.say(done.message);
    return done.message;
  };

  return {
    /**
     * Open the wizard on a file (its first bytes, and its text when it was read whole), into the
     * table dropped on, else one picked by name; on PostgreSQL a new table when none is named so.
     * @param {{ path: string, head: import("./import-copy/start.js").Head, text?: string,
     *   format: Format, into?: Into }} input
     */
    async start({ path, head, text, format, into = {} }) {
      const shown = deps.current();
      const conn =
        deps.manager.get(into.connection ?? shown?.connection ?? "") ?? deps.manager.list()[0];
      if (!conn) throw new Error("No connections yet: add one with New, then drop the file again.");
      const file = path.slice(path.lastIndexOf("/") + 1);
      s = {
        path,
        file,
        text,
        head,
        format,
        pg: isPg(conn),
        copy: null,
        keys: [],
        server: null,
        checking: false,
        progress: null,
        abort: null,
        header: true,
        emptyNull: true,
        connection: conn.id,
        schema: "",
        schemas: [],
        table: "",
        tables: [],
        columns: [],
        mapping: [],
        data: { columns: [], rows: [] },
        problem: "",
        unreadable: "",
        running: false,
      };
      await reparse();
      await load(conn, into);
      if (s?.copy && !s.table && !into.table) s.copy.target = "new";
      publish();
    },

    /** The person changed an option, the target or a column's mapping. @param {Change} change */
    async change(change) {
      if (!s || s.running) return;
      s.problem = "";
      const reread = s.copy ? changeCopy(s.copy, change) : false;
      if (change.header !== undefined || change.empty !== undefined || reread) {
        s.header = change.header ?? s.header;
        s.emptyNull = change.empty ?? s.emptyNull;
        if (change.header !== undefined && s.copy) s.copy.inferred = false;
        await reparse();
        if (!s) return;
        s.mapping = autoMap(s.data.columns, s.columns);
      }
      if (change.map) {
        const [index, name] = change.map;
        // A table column takes one file column: the one it had lets go.
        s.mapping = s.mapping.map((m, i) =>
          i === index ? name : name !== null && m === name ? null : m,
        );
      }
      const conn = deps.manager.get(change.connection ?? s.connection);
      if (
        conn &&
        (change.connection || change.schema !== undefined || change.table !== undefined)
      ) {
        const into = change.connection ? {} : { schema: change.schema ?? s.schema };
        await load(conn, change.table !== undefined ? { ...into, table: change.table } : into);
        if (change.table === "" && s) Object.assign(s, { table: "", columns: [], mapping: [] });
      }
      publish();
    },

    /** Import every row in one transaction; the wizard closes when it is done. */
    async run() {
      const planned = plan();
      if (!s || !planned || s.running) return undefined;
      const { model, statements, conn, dialect } = planned;
      if (model.problem || !conn) {
        deps.view.say(model.problem);
        return undefined;
      }
      if (model.copy) return copyRun(conn);
      const sql = statements.join(";\n");
      const cut = split(sql, dialect);
      if (cut.length !== statements.length)
        throw new Error("The import did not make one statement per batch; nothing was run.");
      s.running = true;
      publish();
      /** @type {string} */
      let message;
      let ok = false;
      try {
        const { result } = await deps.execute(conn, sql, { mode: "transaction", statements: cut });
        const at = result.statements.findIndex((st) => st.error);
        if (result.error) message = `Nothing was imported: ${result.error.message}`;
        else if (at >= 0 || result.statements.some((st) => !st.ran))
          message = `Rolled back, nothing was imported: ${result.statements[at]?.error?.message ?? "the run stopped before the end"}`;
        else {
          ok = true;
          const n = model.rows;
          message = `Imported ${n} row${n === 1 ? "" : "s"} into ${named(conn)} in one transaction.`;
        }
      } catch (error) {
        if (!s) return undefined;
        s.running = false;
        if (/** @type {{ code?: string }} */ (error)?.code === "cancelled") {
          publish();
          return undefined;
        }
        message = messageOf(error);
      }
      if (ok) s = null;
      else if (s) Object.assign(s, { running: false, problem: message });
      publish();
      deps.view.say(message);
      return message;
    },

    /** The server's check of the first rows (PostgreSQL). */
    async check() {
      const conn = deps.manager.get(s?.connection ?? "");
      if (!s?.copy || !conn || s.running || s.checking) return;
      const checking = copies.check(s, conn);
      publish();
      await checking;
      publish();
    },

    /** Close the wizard; while a COPY runs, stop it (it rolls back). */
    cancel() {
      if (s?.abort) {
        s.abort.abort();
        return;
      }
      s = null;
      reads++;
      publish();
    },
    open: () => s !== null,
  };
}
