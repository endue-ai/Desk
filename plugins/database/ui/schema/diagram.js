// An ER diagram of a schema (item 9 of #540): its tables with their columns, and a link for each
// foreign key, read in one run per engine and laid out on a grid, the most linked tables first so
// links stay short. Pure: the view draws the boxes and lines this places.

import { quoteText } from "../sql/quote.js";

/**
 * @typedef {import("../engines/common.js").EngineId} EngineId
 * @typedef {{ name: string, type: string, key: boolean }} DiagramColumn
 * @typedef {{ name: string, columns: DiagramColumn[] }} DiagramTable
 * @typedef {{ name: string, from: string, fromColumns: string, to: string, toColumns: string }} DiagramLink
 * @typedef {{ tables: DiagramTable[], links: DiagramLink[] }} Diagram
 * @typedef {DiagramTable & { x: number, y: number, w: number, h: number, more: number }} Box
 * @typedef {{ link: DiagramLink, points: [number, number][] }} Edge
 * @typedef {{ boxes: Box[], edges: Edge[], width: number, height: number }} Layout
 */

export const SHOWN_COLUMNS = 12;
const LINE = 18;
const HEAD = 26;
const CHAR = 7.2;
const GAP = 56;

/** The two queries a diagram needs: every column of the schema's tables, then its foreign keys. */
export function diagramQueries(/** @type {EngineId} */ engine, /** @type {string} */ schema) {
  if (engine === "postgresql") {
    const s = quoteText("postgresql", schema);
    return [
      "SELECT c.relname, a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod), CASE WHEN " +
        "EXISTS (SELECT 1 FROM pg_catalog.pg_index i WHERE i.indrelid = c.oid AND i.indisprimary " +
        "AND a.attnum = ANY (i.indkey)) THEN 'YES' ELSE 'NO' END FROM pg_catalog.pg_attribute a " +
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
        "ELSE 'NO' END FROM information_schema.COLUMNS c JOIN information_schema.TABLES t ON " +
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
    "SELECT m.name, p.name, p.type, CASE WHEN p.pk > 0 THEN 'YES' ELSE 'NO' END " +
      `${tables.replace("%F%", "pragma_table_info(m.name) p")} ORDER BY m.name, p.cid`,
    "SELECT m.name, 'fk' || f.id, group_concat(f.\"from\", ', '), f.\"table\", " +
      "group_concat(coalesce(f.\"to\", ''), ', ') " +
      `${tables.replace("%F%", "pragma_foreign_key_list(m.name) f")} GROUP BY m.name, f.id ORDER BY 1, 2`,
  ];
}

/**
 * The diagram from the two queries' rows.
 * @param {(string | null)[][]} columns table, column, type, primary ('YES' or 'NO')
 * @param {(string | null)[][]} keys table, name, columns, referenced table, referenced columns
 * @returns {Diagram}
 */
export function diagramOf(columns, keys) {
  /** @type {Map<string, DiagramTable>} */
  const tables = new Map();
  for (const [table, name, type, primary] of columns) {
    const at = tables.get(table ?? "") ?? { name: table ?? "", columns: [] };
    at.columns.push({ name: name ?? "", type: type ?? "", key: primary === "YES" });
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

/**
 * Place the tables on a grid, the most linked first, and route each link from the side of one box
 * to the facing side of the other.
 * @param {Diagram} diagram
 * @returns {Layout}
 */
export function layout(diagram) {
  const degree = (/** @type {string} */ name) =>
    diagram.links.filter((l) => l.from === name || l.to === name).length;
  const ordered = [...diagram.tables].sort(
    (a, b) => degree(b.name) - degree(a.name) || a.name.localeCompare(b.name),
  );
  const across = Math.max(1, Math.ceil(Math.sqrt(ordered.length)));
  /** @type {Box[]} */
  const boxes = [];
  let y = GAP / 2;
  for (let row = 0; row * across < ordered.length; row++) {
    const line = ordered.slice(row * across, (row + 1) * across);
    let x = GAP / 2;
    let tallest = 0;
    for (const table of line) {
      const shown = table.columns.slice(0, SHOWN_COLUMNS);
      const more = table.columns.length - shown.length;
      const widest = Math.max(
        table.name.length + 4,
        ...shown.map((c) => c.name.length + c.type.length + 4),
      );
      const w = Math.round(Math.min(360, Math.max(140, widest * CHAR + 20)));
      const h = HEAD + (shown.length + (more > 0 ? 1 : 0)) * LINE + 8;
      boxes.push({ ...table, x, y, w, h, more });
      x += w + GAP;
      tallest = Math.max(tallest, h);
    }
    y += tallest + GAP;
  }
  const byName = new Map(boxes.map((b) => [b.name, b]));
  /** @type {Edge[]} */
  const edges = diagram.links.map((link) => {
    const a = /** @type {Box} */ (byName.get(link.from));
    const b = /** @type {Box} */ (byName.get(link.to));
    if (a === b) {
      const right = a.x + a.w;
      return {
        link,
        points: [
          [right, a.y + 12],
          [right + 18, a.y + 12],
          [right + 18, a.y + 30],
          [right, a.y + 30],
        ],
      };
    }
    const leftToRight = a.x + a.w <= b.x;
    const rightToLeft = b.x + b.w <= a.x;
    const ay = a.y + Math.min(a.h / 2, HEAD + LINE);
    const by = b.y + Math.min(b.h / 2, HEAD + LINE);
    if (leftToRight || rightToLeft) {
      const from = leftToRight ? a.x + a.w : a.x;
      const to = leftToRight ? b.x : b.x + b.w;
      const mid = (from + to) / 2;
      return {
        link,
        points: [
          [from, ay],
          [mid, ay],
          [mid, by],
          [to, by],
        ],
      };
    }
    const down = a.y < b.y;
    const fromY = down ? a.y + a.h : a.y;
    const toY = down ? b.y : b.y + b.h;
    const ax = a.x + a.w / 2;
    const bx = b.x + b.w / 2;
    const mid = (fromY + toY) / 2;
    return {
      link,
      points: [
        [ax, fromY],
        [ax, mid],
        [bx, mid],
        [bx, toY],
      ],
    };
  });
  const width = Math.max(0, ...boxes.map((b) => b.x + b.w)) + GAP / 2;
  const height = Math.max(0, ...boxes.map((b) => b.y + b.h)) + GAP / 2;
  return { boxes, edges, width, height };
}

export const METRICS = { LINE, HEAD };
