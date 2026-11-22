// A found name as the palette lists it (PaletteResult, specs/plugin/v0): its name, then its kind,
// schema (and table) and connection, and what Enter and Mod+Enter run. Enter opens it: a relation's
// rows (a column's table's), a routine's source, a type's DDL, a console on a schema's database.
// Mod+Enter shows the DDL, and the qualified name is copied from the next action. Pure.

import { qualified, quoteName } from "../../sql/quote.js";
import { RELATIONS } from "./names.js";

/**
 * @typedef {import("./names.js").Name} Name
 * @typedef {import("../../engines/common.js").Connection} Connection
 * @typedef {{ command: string, title: string, args?: Record<string, unknown> }} Action
 * @typedef {{ id: string, title: string, detail: string, kind: string, actions: Action[] }} Result
 */

const capital = (/** @type {string} */ text) => text.charAt(0).toUpperCase() + text.slice(1);

/** A routine's name without its arguments. */
const bare = (/** @type {string} */ title) => {
  const at = title.indexOf("(");
  return at < 0 ? title : title.slice(0, at);
};

/** The name as SQL, every part quoted: a routine's arguments follow its name. */
export function sqlName(/** @type {Name} */ n) {
  const pg = "postgresql";
  if (n.kind === "schema") return quoteName(pg, n.title);
  if (n.kind === "column") return `${qualified(pg, n.schema, n.table)}.${quoteName(pg, n.title)}`;
  if (n.kind === "function" || n.kind === "procedure")
    return `${qualified(pg, n.schema, bare(n.title))}${n.title.slice(bare(n.title).length)}`;
  return qualified(pg, n.schema, n.title);
}

/** What the result's row says under its name. */
function detailOf(/** @type {Name} */ n, /** @type {Connection} */ conn) {
  if (n.kind === "schema") return `Schema · ${conn.name}`;
  if (n.kind === "column")
    return `Column of ${n.schema}.${n.table}${n.type ? ` · ${n.type}` : ""} · ${conn.name}`;
  return `${capital(n.kind)} · ${n.schema} · ${conn.name}`;
}

/** The actions of a name: Enter's first. */
function actionsOf(/** @type {Name} */ n, /** @type {Connection} */ conn) {
  const connection = conn.id;
  const copy = {
    command: "endue.database.copy-name",
    title: "Copy the qualified name",
    args: { text: sqlName(n) },
  };
  const ddl = {
    command: "endue.database.ddl",
    title: "Show the DDL",
    args: { connection, schema: n.schema, name: n.title, kind: n.kind },
  };
  if (n.kind === "schema")
    return [
      { command: "endue.database.console", title: "Open a console", args: { connection } },
      copy,
    ];
  if (n.kind === "column")
    return [
      {
        command: "endue.database.open-table",
        title: "Open the table's rows",
        args: { connection, schema: n.schema, table: n.table },
      },
      copy,
    ];
  if (RELATIONS.has(n.kind))
    return [
      {
        command: "endue.database.open-table",
        title: "Open the rows",
        args: { connection, schema: n.schema, table: n.title },
      },
      ddl,
      copy,
    ];
  if (n.kind === "function" || n.kind === "procedure")
    return [
      {
        command: "endue.database.edit-source",
        title: "Edit the source",
        args: { connection, schema: n.schema, name: n.title, kind: n.kind },
      },
      ddl,
      copy,
    ];
  return [ddl, copy];
}

/**
 * A found name as a PaletteResult. Its id names the connection's database, the kind and the name.
 * @param {Name} n
 * @param {Connection} conn The connection on the name's database.
 * @returns {Result}
 */
export function resultOf(n, conn) {
  return {
    id: JSON.stringify([conn.id, n.kind, n.schema, n.table, n.title]),
    title: n.title,
    detail: detailOf(n, conn),
    kind: n.kind.replaceAll(" ", "-"),
    actions: actionsOf(n, conn),
  };
}
