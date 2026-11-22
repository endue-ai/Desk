// What a name's card says (PG-32), from the connection's schema cache alone (nothing is asked of
// the server): a relation's kind, columns with their types, keys, comment and row estimate; a
// routine's overloads with their results and comments; a column's type, default and comment; a
// type's kind; an alias's or a CTE's what it stands for. Pure.

/**
 * @typedef {import("./target.js").Aim} Aim
 * @typedef {import("../schema-cache/view.js").CacheView} CacheView
 * @typedef {{ name: string, type: string, key?: string, default?: string, comment?: string }} CardColumn
 * @typedef {{ text: string, comment?: string }} CardSignature
 * @typedef {{
 *   kind: string, title: string, comment?: string, estimate?: number, detail?: string,
 *   type?: string, default?: string, notNull?: boolean, columns?: CardColumn[], keys?: string[],
 *   signatures?: CardSignature[], more?: number,
 * }} Card
 *   `more` counts the columns left out past the first MAX_COLUMNS.
 */

/** Columns a card lists; the rest are counted. */
export const MAX_COLUMNS = 24;
const RELATIONS = new Set(["table", "view", "materialized view", "foreign table", "sequence"]);
const KEYS = new Set(["primary key", "unique", "foreign key"]);

/** The foreign key a column is the first column of, as `→ schema.table.column`. */
function referenceOf(
  /** @type {ReturnType<CacheView["foreignKeys"]>} */ keys,
  /** @type {string} */ column,
  /** @type {string} */ schema,
) {
  const key = keys?.find((k) => k.columns.length === 1 && k.columns[0] === column);
  if (!key) return undefined;
  const table = key.schema === schema ? key.table : `${key.schema}.${key.table}`;
  return `→ ${table}.${key.refColumns[0] ?? ""}`;
}

/** A relation's card, or null when the cache does not hold it. @returns {Card | null} */
function relationCard(
  /** @type {CacheView} */ view,
  /** @type {string} */ schema,
  /** @type {string} */ name,
) {
  const object = view.objects(schema)?.find((o) => o.name === name && RELATIONS.has(o.kind));
  if (!object) return null;
  const keys = view.foreignKeys(schema, name);
  const all = view.columns(schema, name) ?? [];
  const columns = all.slice(0, MAX_COLUMNS).map((c) => {
    const key = c.primary ? "primary key" : referenceOf(keys, c.name, schema);
    return {
      name: c.name,
      type: c.type,
      ...(key ? { key } : {}),
      ...(c.default ? { default: c.default } : {}),
      ...(c.comment ? { comment: c.comment } : {}),
    };
  });
  const parts = (view.parts(schema, name) ?? []).filter((p) => KEYS.has(p.kind));
  const comment = view.comment(schema, name);
  return {
    kind: object.detail ? `${object.kind} · ${object.detail}` : object.kind,
    title: `${schema}.${name}`,
    ...(comment ? { comment } : {}),
    ...(object.rows !== null && object.kind !== "view" ? { estimate: object.rows } : {}),
    ...(columns.length ? { columns } : {}),
    ...(all.length > MAX_COLUMNS ? { more: all.length - MAX_COLUMNS } : {}),
    ...(parts.length ? { keys: parts.map((p) => p.detail || p.name) } : {}),
  };
}

/**
 * The card of an aim, or null when the cache holds nothing to say of it.
 * @param {CacheView} view
 * @param {Aim} aim
 * @returns {Card | null}
 */
export function cardOf(view, aim) {
  if (aim.kind === "relation") return relationCard(view, aim.schema, aim.name);
  if (aim.kind === "column") {
    const column = view.columns(aim.schema, aim.table)?.find((c) => c.name === aim.name);
    if (!column) return null;
    const key = column.primary
      ? "primary key"
      : referenceOf(view.foreignKeys(aim.schema, aim.table), aim.name, aim.schema);
    return {
      kind: key ? `column · ${key}` : "column",
      title: `${aim.schema}.${aim.table}.${aim.name}`,
      type: column.type,
      ...(column.nullable === false ? { notNull: true } : {}),
      ...(column.default ? { default: column.default } : {}),
      ...(column.comment ? { comment: column.comment } : {}),
    };
  }
  if (aim.kind === "function") {
    const overloads = (view.routines(aim.schema) ?? []).filter((r) => r.name === aim.name);
    if (overloads.length === 0) return null;
    return {
      kind: overloads[0]?.kind ?? "function",
      title: `${aim.schema}.${aim.name}`,
      signatures: overloads.map((r) => ({
        text: `${r.name}(${r.args})${r.result ? ` → ${r.result}` : ""}`,
        ...(r.comment ? { comment: r.comment } : {}),
      })),
    };
  }
  if (aim.kind === "type") {
    const object = view.objects(aim.schema)?.find((o) => o.kind === "type" && o.name === aim.name);
    if (!object) return null;
    return {
      kind: "type",
      title: `${aim.schema}.${aim.name}`,
      ...(object.detail ? { detail: object.detail } : {}),
      ...(object.comment ? { comment: object.comment } : {}),
    };
  }
  if (aim.kind === "schema") {
    const objects = view.objects(aim.name);
    if (!objects) return null;
    return { kind: "schema", title: aim.name, detail: `${objects.length} objects` };
  }
  if (aim.kind === "alias") {
    const of = aim.of;
    if (of.kind === "relation" && of.schema) {
      const card = relationCard(view, of.schema, of.name);
      return card && { ...card, title: `${aim.name}: ${card.title}` };
    }
    return { kind: of.kind, title: aim.name };
  }
  if (aim.kind === "cte") return { kind: "CTE", title: aim.name };
  return null;
}
