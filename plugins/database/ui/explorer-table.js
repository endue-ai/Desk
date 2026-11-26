// The explorer's rows under a relation (explorer.js): its Columns folder, read when it opens, then
// a folder per kind of part (keys, foreign keys, indexes, triggers, and PG-50's partitions,
// inherits, policies and rules) once its parts are read. No DOM.

import { formatCount } from "./format.js";
import { PART_FOLDERS, RELATIONS } from "./schema/common.js";
import { TABLE_FOLDERS } from "./schema/pg/index.js";
import { partDetail } from "./schema/pg/tree.js";
import { t } from "./strings/index.js";

/**
 * @typedef {import("./engines/common.js").Connection} Connection
 * @typedef {import("./schema/common.js").SchemaObject} SchemaObject
 * @typedef {import("./schema/common.js").Part} Part
 * @typedef {import("./explorer.js").Node} Node
 * @typedef {import("./explorer.js").Load} Load
 * @typedef {{
 *   catalog: Pick<import("./explorer.js").Catalog, "columns" | "parts">,
 *   load(key: string, read: () => Promise<unknown[]>): Load,
 *   push(node: Omit<Node, "expanded"> & { expanded?: boolean }): boolean,
 *   info(key: string, state: Load, level: number, connection: string): void,
 * }} At
 */

const SEP = "\u0000";

/**
 * A relation's columns, then its parts by folder.
 * @param {At} at
 * @param {Connection} conn
 * @param {SchemaObject} object
 * @param {string} key The relation's row.
 */
export function tableRows(at, conn, object, key) {
  const { catalog, load, push, info } = at;
  const base = { connection: conn.id, schema: object.schema, table: object.name, scope: key };
  const columnsKey = `${key}${SEP}columns`;
  const columnsOpen = push({
    ...base,
    key: columnsKey,
    kind: "folder",
    label: t("explorerTable.columns"),
    detail: "",
    level: 5,
    expandable: true,
  });
  if (columnsOpen) {
    const state = load(columnsKey, () => catalog.columns(conn, object.schema, object.name));
    if (state.status !== "ready" || state.items.length === 0) info(columnsKey, state, 6, conn.id);
    else
      for (const column of /** @type {import("./catalog.js").Column[]} */ (state.items)) {
        const flags = [
          column.primary ? "PK" : "",
          column.nullable ? "" : "NOT NULL",
          column.default !== null ? `= ${column.default}` : "",
        ].filter(Boolean);
        push({
          ...base,
          key: `${columnsKey}${SEP}${column.name}`,
          kind: "column",
          label: column.name,
          detail: [column.type, ...flags].join(" "),
          level: 6,
          expandable: false,
        });
      }
  }
  if (!RELATIONS.has(object.kind) || object.kind === "view") return;
  const partsKey = `${key}${SEP}parts`;
  const state = load(partsKey, () => catalog.parts(conn, object.schema, object.name));
  if (state.status !== "ready") {
    info(partsKey, state, 5, conn.id);
    return;
  }
  const parts = /** @type {Part[]} */ (state.items);
  for (const [label, kinds] of [...PART_FOLDERS, ...TABLE_FOLDERS]) {
    const held = parts.filter((p) => /** @type {readonly string[]} */ (kinds).includes(p.kind));
    if (held.length === 0) continue;
    const folderKey = `${key}${SEP}p${SEP}${label}`;
    const open = push({
      ...base,
      key: folderKey,
      kind: "folder",
      label,
      detail: formatCount(held.length),
      level: 5,
      expandable: true,
    });
    if (!open) continue;
    for (const part of held)
      push({
        ...base,
        key: `${folderKey}${SEP}${part.name}`,
        kind: "part",
        label: part.name,
        detail: partDetail(part),
        level: 6,
        expandable: false,
        part,
      });
  }
}
