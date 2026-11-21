// An ER diagram of a schema (item 9 of #540): its tables with their columns (type, key, nullability
// and comment), and a link for each foreign key, read in one run per engine where the schema cache
// does not hold the schema. Pure: features/diagram/ lays it out and draws it (PG-55).

import { quoteText } from "../sql/quote.js";

/**
 * @typedef {import("../engines/common.js").EngineId} EngineId
 * @typedef {{ name: string, type: string, key: boolean, nullable?: boolean, comment?: string }} DiagramColumn
 * @typedef {{ name: string, columns: DiagramColumn[] }} DiagramTable
 * @typedef {{ name: string, from: string, fromColumns: string, to: string, toColumns: string }} DiagramLink
 * @typedef {{ tables: DiagramTable[], links: DiagramLink[] }} Diagram
 */

/** The two queries a diagram needs: every column of the schema's tables, then its foreign keys. */
export function diagramQueries(/** @type {EngineId} */ engine, /** @type {string} */ schema) {
  if (engine === "postgresql") {
    const s = quoteText("postgresql", schema);
    return [
      "SELECT c.relname, a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod), CASE WHEN " +
        "EXISTS (SELECT 1 FROM pg_catalog.pg_index i WHERE i.indrelid = c.oid AND i.indisprimary " +
        "AND a.attnum = ANY (i.indkey)) THEN 'YES' ELSE 'NO' END, CASE WHEN a.attnotnull THEN 'NO' " +
        "ELSE 'YES' END, pg_catalog.col_description(c.oid, a.attnum) FROM pg_catalog.pg_attribute a " +
        "JOIN pg_catalog.pg_class c ON c.oid = a.attrelid JOIN pg_catalog.pg_namespace n ON " +
        `n.oid = c.relnamespace WHERE n.nspname = ${s} AND c.relkind IN ('r', 'p') AND NOT ` +
        "c.relispartition AND a.attnum > 0 AND NOT a.attisdropped ORDER BY c.relname, a.attnum",
      "SELECT c.relname, k.conname, (SELECT string_agg(a.attname, ', ' ORDER BY u.o) FROM " +
        "unnest(k.conkey) WITH ORDINALITY u(n, o) JOIN pg_catalog.pg_attribute a ON a.attrelid = " +
        "k.conrelid AND a.attnum = u.n), r.relname, (SELECT string_agg(a.attname, ', ' ORDER BY u.o) " +
        "FROM unnest(k.confkey) WITH ORDINALITY u(n, o) JOIN pg_catalog.pg_attribute a ON " +
        "a.attrelid = k.confrelid AND a.attnum = u.n) FROM pg_catalog.pg_constraint k JOIN " +
        "pg_catalog.pg_class c ON c.oid = k.conrelid JOIN pg_catalog.pg_class r ON r.oid = " +
        "k.confrelid JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace JOIN " +
        "pg_catalog.pg_namespace rn ON rn.oid = r.relnamespace WHERE k.contype = 'f' AND " +
        `n.nspname = ${s} AND rn.nspname = ${s} ORDER BY 1, 2`,
    ];
  }
  if (engine === "mysql") {
    const s = quoteText("mysql", schema);
    return [
      "SELECT c.TABLE_NAME, c.COLUMN_NAME, c.COLUMN_TYPE, CASE c.COLUMN_KEY WHEN 'PRI' THEN 'YES' " +
        "ELSE 'NO' END, c.IS_NULLABLE, c.COLUMN_COMMENT FROM information_schema.COLUMNS c JOIN " +
        "information_schema.TABLES t ON " +
        "t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME WHERE c.TABLE_SCHEMA = " +
        `${s} AND t.TABLE_TYPE = 'BASE TABLE' ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION`,
      "SELECT TABLE_NAME, CONSTRAINT_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY ORDINAL_POSITION " +
        "SEPARATOR ', '), REFERENCED_TABLE_NAME, GROUP_CONCAT(REFERENCED_COLUMN_NAME ORDER BY " +
        "ORDINAL_POSITION SEPARATOR ', ') FROM information_schema.KEY_COLUMN_USAGE WHERE " +
        `TABLE_SCHEMA = ${s} AND REFERENCED_TABLE_SCHEMA = ${s} GROUP BY TABLE_NAME, ` +
        "CONSTRAINT_NAME, REFERENCED_TABLE_NAME ORDER BY 1, 2",
    ];
  }
  const tables =
    "FROM sqlite_master m JOIN %F% WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite\\_%' ESCAPE '\\'";
  return [
    "SELECT m.name, p.name, p.type, CASE WHEN p.pk > 0 THEN 'YES' ELSE 'NO' END, CASE WHEN " +
      "p.\"notnull\" = 0 AND p.pk = 0 THEN 'YES' ELSE 'NO' END " +
      `${tables.replace("%F%", "pragma_table_info(m.name) p")} ORDER BY m.name, p.cid`,
    "SELECT m.name, 'fk' || f.id, group_concat(f.\"from\", ', '), f.\"table\", " +
      "group_concat(coalesce(f.\"to\", ''), ', ') " +
      `${tables.replace("%F%", "pragma_foreign_key_list(m.name) f")} GROUP BY m.name, f.id ORDER BY 1, 2`,
  ];
}

/**
 * The diagram from the two queries' rows.
 * @param {(string | null)[][]} columns table, column, type, primary ('YES' or 'NO'), and, where the
 *   engine gives them, nullable ('YES' or 'NO') and comment
 * @param {(string | null)[][]} keys table, name, columns, referenced table, referenced columns
 * @returns {Diagram}
 */
export function diagramOf(columns, keys) {
  /** @type {Map<string, DiagramTable>} */
  const tables = new Map();
  for (const [table, name, type, primary, nullable, comment] of columns) {
    const at = tables.get(table ?? "") ?? { name: table ?? "", columns: [] };
    at.columns.push({
      name: name ?? "",
      type: type ?? "",
      key: primary === "YES",
      ...(nullable === undefined ? {} : { nullable: nullable === "YES" }),
      ...(comment ? { comment } : {}),
    });
    tables.set(at.name, at);
  }
  const links = keys
    .map(([from, name, fromColumns, to, toColumns]) => ({
      name: name ?? "",
      from: from ?? "",
      fromColumns: fromColumns ?? "",
      to: to ?? "",
      toColumns: toColumns ?? "",
    }))
    .filter((l) => tables.has(l.from) && tables.has(l.to));
  return { tables: [...tables.values()], links };
}
