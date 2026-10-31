// Names and literals written safely for each dialect, for the SQL the plugin writes itself (the
// explorer's catalog queries, a table's rows, copy as INSERT). A name is always quoted; a literal
// never closes early whatever it holds.

/** @typedef {import("./lexer.js").Dialect} Dialect */

/** A quoted identifier: "name" (PostgreSQL, SQLite) or `name` (MySQL), the quote doubled inside. */
export function quoteName(/** @type {Dialect} */ dialect, /** @type {string} */ name) {
  if (dialect === "mysql") return `\`${name.replaceAll("`", "``")}\``;
  return `"${name.replaceAll('"', '""')}"`;
}

/** A schema-qualified name; the schema is left out when empty (SQLite's main). */
export function qualified(
  /** @type {Dialect} */ dialect,
  /** @type {string} */ schema,
  /** @type {string} */ name,
) {
  return schema
    ? `${quoteName(dialect, schema)}.${quoteName(dialect, name)}`
    : quoteName(dialect, name);
}

/**
 * A string literal. PostgreSQL uses E'' when a backslash is inside, so the value is the same with or
 * without standard_conforming_strings; MySQL doubles quotes and backslashes.
 * @param {Dialect} dialect
 * @param {string} value
 */
export function quoteText(dialect, value) {
  const doubled = value.replaceAll("'", "''");
  if (dialect === "mysql") return `'${doubled.replaceAll("\\", "\\\\")}'`;
  if (dialect === "postgresql" && value.includes("\\"))
    return `E'${doubled.replaceAll("\\", "\\\\")}'`;
  return `'${doubled}'`;
}
