// An object's usages as the panel lists them (PG-32), each saying where it was found: `catalog`, what
// the server's dependency catalog records (usages-sql.js), and `parsed`, what was read from source:
// routine bodies the catalog does not record (mentions.js), the open consoles of the connection and
// the .sql files they are bound to, bound by the parse worker's resolver. A routine the catalog
// already lists is not listed again. Pure.

import { matches } from "./target.js";

/**
 * @typedef {import("./target.js").Aim} Aim
 * @typedef {import("../sql/parse/scope.js").Name} Name
 * @typedef {(string | null)[]} Row
 * @typedef {{
 *   source: "catalog" | "parsed", kind: string, schema?: string, name: string, table?: string,
 *   detail?: string, console?: string, file?: string, from?: number, to?: number, line?: number,
 *   count?: number,
 * }} Usage
 *   A routine's `detail` is its identity arguments; a console place has the console's id, where
 *   the name is (`from`, `to`, `line`) and, bound to a file, its path; `count` how many places a
 *   routine body or a console holds.
 */

const text = (/** @type {unknown} */ v) => (v === null || v === undefined ? "" : String(v));

/** The catalog's rows (kind, schema, name, table, detail) as usages. @returns {Usage[]} */
export function catalogUsages(/** @type {Row[]} */ rows) {
  return rows.map(([kind, schema, name, table, detail]) => ({
    source: "catalog",
    kind: text(kind),
    schema: text(schema),
    name: text(name),
    ...(text(table) ? { table: text(table) } : {}),
    ...(text(detail) ? { detail: text(detail) } : {}),
  }));
}

/** The key of a routine, to tell one the catalog lists from one found in its body. */
const routineKey = (
  /** @type {string} */ schema,
  /** @type {string} */ name,
  /** @type {string} */ args,
) => `${schema}\u0000${name}\u0000${args}`;

/**
 * The routine bodies to scan (schema, name, arguments, kind, language, source), without those the
 * catalog lists already.
 * @param {Row[]} rows
 * @param {Usage[]} listed
 */
export function bodiesOf(rows, listed) {
  const known = new Set(
    listed
      .filter((u) => u.kind === "function" || u.kind === "procedure")
      .map((u) => routineKey(u.schema ?? "", u.name, u.detail ?? "")),
  );
  return rows.flatMap(([schema, name, args, kind, language, source]) =>
    known.has(routineKey(text(schema), text(name), text(args)))
      ? []
      : [
          {
            schema: text(schema),
            name: text(name),
            args: text(args),
            kind: text(kind),
            language: text(language),
            source: text(source),
          },
        ],
  );
}

/**
 * A scanned body that names the aim, as a usage.
 * @param {ReturnType<typeof bodiesOf>[number]} body
 * @param {{ places: import("./mentions.js").Mention[], count: number }} found
 * @returns {Usage | null}
 */
export function bodyUsage(body, found) {
  if (found.count === 0) return null;
  return {
    source: "parsed",
    kind: body.kind,
    schema: body.schema,
    name: body.name,
    detail: body.args,
    line: found.places[0]?.line ?? 1,
    count: found.count,
  };
}

/**
 * The places a console's resolution names the aim, as one usage per place.
 * @param {{ id: string, name: string, file?: { path: string } }} console
 * @param {string} text the console's text
 * @param {Name[]} names its resolution
 * @param {Aim} aim
 * @returns {Usage[]}
 */
export function consoleUsages(console, text, names, aim) {
  return names
    .filter((n) => matches(aim, n))
    .map((n) => ({
      source: "parsed",
      kind: "console",
      name: console.name,
      console: console.id,
      ...(console.file ? { file: console.file.path } : {}),
      from: n.start.offset,
      to: n.end.offset,
      line: n.start.line,
      detail: lineOf(text, n.start.offset),
    }));
}

/** The line around an offset, trimmed to what a row shows. */
export function lineOf(/** @type {string} */ text, /** @type {number} */ at) {
  const start = text.lastIndexOf("\n", at - 1) + 1;
  const end = text.indexOf("\n", at);
  const line = text.slice(start, end < 0 ? text.length : end).trim();
  return line.length > 120 ? `${line.slice(0, 119)}…` : line;
}
