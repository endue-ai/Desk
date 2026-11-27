// The explorer's rows of PG-50's kinds (explorer.js draws the rest): a cached connection's Database
// and Server rows after its schemas, each opening to its folders (index.js) and each object a row
// whose `d` shows its DDL; and what an object's or a part's row says beside its name, a table's
// size among it. A refresh on any of these rows reads the database level again. No DOM.

import { formatBytes, formatCount } from "../../format.js";
import { t } from "../../strings/index.js";
import { DATABASE, isNewKind, LEVELS } from "./index.js";

/**
 * @typedef {import("../common.js").SchemaObject} SchemaObject
 * @typedef {import("../common.js").Part} Part
 * @typedef {import("../../explorer.js").Node} Node
 * @typedef {(node: Omit<Node, "expanded"> & { expanded?: boolean }) => boolean} Push
 */

const SEP = "\u0000";

/**
 * The Database and Server rows, and under each open one its folders and their objects.
 * @param {{
 *   conn: { id: string, database?: string }, key: string, objects: SchemaObject[], push: Push,
 *   filter: string,
 * }} at `key` is the rows' prefix and what a refresh on them drops; `filter` keeps the objects
 *   whose name holds it, as the explorer's filter does.
 */
export function levelRows({ conn, key, objects, push, filter }) {
  const matches = (/** @type {string} */ name) =>
    filter === "" || name.toLowerCase().includes(filter.toLowerCase());
  const base = { connection: conn.id, schema: DATABASE, scope: key };
  for (const level of LEVELS) {
    const levelKey = `${key}${SEP}${level.id}`;
    const open = push({
      ...base,
      key: levelKey,
      kind: "folder",
      label: level.label,
      detail: level.id === "database" ? (conn.database ?? "") : "",
      level: 2,
      expandable: true,
    });
    if (!open) continue;
    let any = false;
    for (const [label, kinds] of level.folders) {
      const all = objects.filter((o) => /** @type {readonly string[]} */ (kinds).includes(o.kind));
      const shown = all.filter((o) => matches(o.name));
      if (shown.length === 0) continue;
      any = true;
      const folderKey = `${levelKey}${SEP}f${SEP}${label}`;
      const folderOpen = push({
        ...base,
        key: folderKey,
        kind: "folder",
        label,
        detail: filter
          ? t("schema.pg.tree.of", { length: String(shown.length), length2: String(all.length) })
          : formatCount(all.length),
        level: 3,
        expandable: true,
      });
      if (folderOpen)
        for (const object of shown)
          push({
            ...base,
            key: `${folderKey}${SEP}o${SEP}${object.name}`,
            kind: "object",
            label: object.name,
            detail: object.detail,
            level: 4,
            expandable: false,
            object,
          });
    }
    if (!any)
      push({
        ...base,
        key: `${levelKey}${SEP}info`,
        kind: "info",
        label: t("schema.pg.tree.empty"),
        detail: "",
        level: 3,
        expandable: false,
      });
  }
}

/** What an object's row says: its kind (but a table's, a view's or a new kind's), detail, rows, size. */
export function objectDetail(/** @type {SchemaObject} */ object, /** @type {string} */ rows) {
  const plain = object.kind === "table" || object.kind === "view" || isNewKind(object.kind);
  const size = object.bytes ? `~${formatBytes(object.bytes)}` : "";
  return [plain ? "" : object.kind, object.detail, rows, size].filter(Boolean).join(" · ");
}

/** What a part's row says: an index's, a foreign key's or a new part's detail, else its kind. */
export const partDetail = (/** @type {Part} */ part) =>
  part.kind === "index" || part.kind === "foreign key" || isNewKind(part.kind)
    ? part.detail
    : part.kind;
