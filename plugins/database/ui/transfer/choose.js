// What a copy is of (PG-63): a PostgreSQL connection (the one named, on screen, the only one or one
// picked), its tables (named by the caller, the table on screen, else a whole schema or one table
// picked in the palette) or the console's statement (the selection, else the one at the caret), and
// the target the form answers, checked: PostgreSQL, not read-only, its database the one named. No DOM.

import { engineOf } from "../engines/index.js";
import { split, statementAt } from "../sql/split.js";
import { t as messageText } from "../strings/index.js";

/**
 * @typedef {import("../feature-host.js").Deps} Deps
 * @typedef {import("../engines/common.js").Connection} Connection
 * @typedef {import("./ddl.js").Name} Name
 */

const WHOLE = "\u0000";

/** A connection a copy reads from or writes to, or the sentence why not. */
export function postgres(/** @type {Connection} */ conn) {
  if (conn.engine !== "postgresql")
    throw new Error(
      messageText("transfer.choose.isTablesAreCopiedBetweenPostgresql", {
        name: String(conn.name),
        title: String(engineOf(conn.engine).title),
      }),
    );
  return conn;
}

/**
 * The target the form names: its connection on the database asked for.
 * @param {Pick<Deps, "manager">} deps
 * @param {{ target?: unknown, database?: unknown }} answer
 */
export function targetOf(deps, answer) {
  const conn = deps.manager.get(String(answer.target ?? ""));
  if (!conn) throw new Error(messageText("transfer.choose.chooseTheConnectionToCopyInto"));
  postgres(conn);
  if (conn.readOnly)
    throw new Error(
      messageText("transfer.choose.isReadOnlyNothingIsCopied", { name: String(conn.name) }),
    );
  const database = String(answer.database ?? "").trim();
  return database && database !== conn.database ? { ...conn, database } : conn;
}

/** @param {Pick<Deps, "manager" | "consoles" | "catalog" | "pick" | "view">} deps */
export function createChooser(deps) {
  /** The connection named, else the one on screen, the only one or one picked. */
  const source = async (/** @type {unknown} */ ref) => {
    if (typeof ref === "string" && ref !== "") {
      const conn = deps.manager.get(ref);
      if (!conn)
        throw new Error(messageText("transfer.choose.noConnectionIsNamed", { ref: String(ref) }));
      return postgres(conn);
    }
    const shown = deps.consoles.current();
    const here = shown ? deps.manager.get(shown.connection) : undefined;
    if (here?.engine === "postgresql") return here;
    const list = deps.manager.list().filter((c) => c.engine === "postgresql");
    if (list.length === 0)
      throw new Error(messageText("transfer.choose.noPostgresqlConnectionYetAddOne"));
    if (list.length === 1) return list[0];
    const items = list.map((c) => ({ id: c.id, label: c.name }));
    const picked = await deps.pick(
      messageText("transfer.choose.databaseCopyTablesFromWhichConnection"),
      items,
    );
    return picked ? deps.manager.get(picked) : undefined;
  };

  /**
   * The tables the caller names, else the one on screen, else a schema's or one picked.
   * @param {Connection} conn
   * @param {{ schema?: unknown, table?: unknown, tables?: unknown }} args
   * @returns {Promise<Name[] | undefined>}
   */
  const tables = async (conn, args) => {
    const schema = typeof args.schema === "string" ? args.schema : "";
    const named = Array.isArray(args.tables)
      ? args.tables.map(String)
      : typeof args.table === "string"
        ? [args.table]
        : [];
    if (named.length)
      return named.map((n) => {
        const dot = n.indexOf(".");
        if (schema || dot < 0) return { schema: schema || "public", name: n };
        return { schema: n.slice(0, dot), name: n.slice(dot + 1) };
      });
    const shown = deps.consoles.current();
    if (shown?.kind === "table" && shown.connection === conn.id && shown.table)
      return [{ schema: shown.table.schema, name: shown.table.name }];
    const schemas = await deps.catalog.schemas(conn);
    const first =
      schema ||
      (await deps.pick(
        messageText("transfer.choose.databaseCopyTablesOfWhichSchema"),
        schemas.map((s) => ({ id: s, label: s })),
      ));
    if (!first) return undefined;
    const all = (await deps.catalog.objects(conn, first)).filter((o) => o.kind === "table");
    if (all.length === 0)
      throw new Error(messageText("transfer.choose.schemaHasNoTables", { first: String(first) }));
    const second = await deps.pick(
      messageText("transfer.choose.databaseCopyWhichTableOf", { first: String(first) }),
      [
        {
          id: WHOLE,
          label: messageText("transfer.choose.everyTableOf", { first: String(first) }),
          detail: `${all.length}`,
        },
        ...all.map((t) => ({ id: t.name, label: t.name })),
      ],
    );
    if (!second) return undefined;
    return second === WHOLE
      ? all.map((t) => ({ schema: first, name: t.name }))
      : [{ schema: first, name: second }];
  };

  /** The console's statement: the selection, else the one at the caret. */
  const statement = () => {
    const target = deps.consoles.current();
    if (target?.kind !== "console")
      throw new Error(messageText("transfer.choose.copyAQuerySResultFrom"));
    const conn = deps.manager.get(target.connection);
    if (!conn) throw new Error(messageText("transfer.choose.thisConsoleSConnectionWasRemoved"));
    postgres(conn);
    const { text, start, end } = deps.view.editor();
    const picked = start !== end ? split(text.slice(start, end), "postgresql") : [];
    const at = start === end ? statementAt(split(text, "postgresql"), start, text) : undefined;
    const statements = at ? [at] : picked;
    if (statements.length !== 1)
      throw new Error(messageText("transfer.choose.putTheCaretInOneQuery"));
    return { conn, sql: /** @type {{ text: string }} */ (statements[0]).text };
  };

  return { source, tables, statement };
}
