// After JOIN: the tables a foreign key links to the tables before it, each key a candidate that
// writes its ON condition, both ways (a key of the table in FROM, or one that points at it). The
// condition qualifies with the joined table's name, or an alias when that name is already a FROM item
// (a key to the table itself); a table already in FROM is not offered again. Pure.

import { keyOf } from "./rank.js";

/**
 * @typedef {import("../sql/lexer.js").Dialect} Dialect
 * @typedef {import("./rank.js").Item} Item
 * @typedef {{ name: string, type?: string, comment?: string, default?: boolean }} Column
 * @typedef {{ name: string, relation?: { schema: string, name: string }, columns: Column[] | null }} Entry
 * @typedef {{ columns: string[], schema: string, table: string, refColumns: string[] }} ForeignKey
 * @typedef {{
 *   foreignKeys?(schema: string, table: string): ForeignKey[] | undefined,
 *   referencing?(schema: string, table: string): Array<ForeignKey & { from: { schema: string, table: string } }>,
 *   comment?(schema: string, table: string): string,
 *   visible?(schema: string, table: string): boolean,
 * }} JoinView
 */

/** A short alias from a table's name that no FROM item has: its initials, then a number. */
function aliasFor(/** @type {string} */ table, /** @type {Set<string>} */ taken) {
  const initials =
    table
      .split(/[^A-Za-z0-9]+/u)
      .filter(Boolean)
      .map((w) => w[0]?.toLowerCase())
      .join("") || "t";
  let alias = initials;
  for (let n = 2; taken.has(alias); n++) alias = `${initials}${n}`;
  return alias;
}

/**
 * @param {Entry[]} entries the FROM items before the JOIN
 * @param {JoinView} view
 * @param {(name: string) => string} ident a name as it must be written
 * @param {boolean} upper whether the statement writes keywords in capitals
 * @returns {Item[]}
 */
export function joinItems(entries, view, ident, upper) {
  const taken = new Set(entries.map((e) => e.name));
  const inFrom = new Set(
    entries.flatMap((e) => (e.relation ? [`${e.relation.schema}.${e.relation.name}`] : [])),
  );
  const [on, and] = upper ? ["ON", "AND"] : ["on", "and"];
  /** @type {Item[]} */
  const items = [];
  const add = (
    /** @type {Entry} */ entry,
    /** @type {{ schema: string, table: string }} */ target,
    /** @type {Array<[string, string]>} */ pairs,
  ) => {
    const self = entry.relation?.schema === target.schema && entry.relation?.name === target.table;
    if (!self && inFrom.has(`${target.schema}.${target.table}`)) return;
    const shown = view.visible?.(target.schema, target.table) ?? true;
    const name = shown ? ident(target.table) : `${ident(target.schema)}.${ident(target.table)}`;
    const alias = taken.has(target.table) ? aliasFor(target.table, taken) : "";
    const by = alias || name;
    const condition = pairs
      .map(([theirs, ours]) => `${by}.${ident(theirs)} = ${ident(entry.name)}.${ident(ours)}`)
      .join(` ${and} `);
    const comment = view.comment?.(target.schema, target.table) ?? "";
    items.push({
      label: shown ? target.table : `${target.schema}.${target.table}`,
      kind: "join",
      detail: `${on} ${condition}`,
      insert: `${name}${alias ? ` ${alias}` : ""} ${on} ${condition}`,
      ...(comment ? { info: comment } : {}),
      key: keyOf("join", target.table),
    });
  };
  for (const entry of entries) {
    const rel = entry.relation;
    if (!rel) continue;
    for (const key of view.foreignKeys?.(rel.schema, rel.name) ?? [])
      add(
        entry,
        { schema: key.schema, table: key.table },
        key.refColumns.map((c, i) => [c, key.columns[i] ?? ""]),
      );
    for (const key of view.referencing?.(rel.schema, rel.name) ?? [])
      add(
        entry,
        key.from,
        key.columns.map((c, i) => [c, key.refColumns[i] ?? ""]),
      );
  }
  return items;
}
