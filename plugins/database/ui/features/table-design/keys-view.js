// The table form's keys and foreign keys (PG-51): the primary key, unique and check constraints
// (and an exclusion constraint, kept), each with its name (empty lets the server name it) and its
// columns or expression; a foreign key with its columns, the table it references (another one of a
// schema's, or this one) and that table's columns, and its ON DELETE and ON UPDATE actions. A part
// the form cannot write shows its definition and can be renamed or removed.

import { el } from "../../dom.js";
import { columnsPick, itemList, selectField, textField } from "./bits.js";
import { addPart, removePart, setPart } from "./edits.js";
import { ACTIONS, living, nextId } from "./model.js";

/**
 * @typedef {import("./model.js").Design} Design
 * @typedef {import("./model.js").ListName | "primaryKey"} List
 * @typedef {import("./columns-view.js").Ctx & {
 *   refs: import("./controller.js").Refs, load(schema: string, table?: string): void,
 * }} Ctx
 */

const KEPT_WORDS =
  "The form does not write this one (DEFERRABLE, NOT VALID, INCLUDE ... ): it is kept as it is. Rename or remove it here; change it in a console.";

/** Every constraint of the keys section, with the list it is in. */
function keysOf(/** @type {Design} */ d) {
  return [
    ...(d.primaryKey
      ? [{ list: /** @type {List} */ ("primaryKey"), part: d.primaryKey, what: "Primary key" }]
      : []),
    ...d.uniques.map((part) => ({ list: /** @type {List} */ ("uniques"), part, what: "Unique" })),
    ...d.checks.map((part) => ({ list: /** @type {List} */ ("checks"), part, what: "Check" })),
    ...d.others.map((part) => ({ list: /** @type {List} */ ("others"), part, what: "Exclusion" })),
  ];
}

/** The name field, a kept part's definition, and Remove. */
function common(
  /** @type {Ctx} */ ctx,
  /** @type {List} */ list,
  /** @type {{ id: string, name: string, kept?: string }} */ part,
) {
  const { doc } = ctx;
  const name = textField(
    doc,
    {
      key: `${list}:${part.id}:name`,
      label: "Name",
      value: part.name,
      placeholder: "the server names it",
    },
    (v) => ctx.set((d) => setPart(d, list, part.id, { name: v }), false),
  );
  const remove = el(
    doc,
    "button",
    { type: "button", class: "desk-btn desk-btn-danger", "data-key": `${list}:${part.id}:remove` },
    "Remove",
  );
  remove.addEventListener("click", () => {
    ctx.set((d) => removePart(d, list, part.id), false);
    ctx.select("");
  });
  const kept = part.kept
    ? [
        el(doc, "pre", { class: "td-kept" }, part.kept),
        el(doc, "p", { class: "td-note" }, KEPT_WORDS),
      ]
    : [];
  return { name, kept, remove: el(doc, "div", { class: "td-buttons" }, remove) };
}

/** The keys section: the primary key, unique and check constraints. */
export function keysView(/** @type {Ctx} */ ctx) {
  const { doc, design } = ctx;
  const all = keysOf(design);
  const shown = all.find((k) => k.part.id === ctx.selected) ?? all[0];
  const columns = living(design);
  const list = itemList(
    doc,
    {
      key: "keys",
      label: "Keys",
      items: all.map(({ part, what }) => ({
        id: part.id,
        title: part.name || "(named by the server)",
        detail: what,
        ...(part.kept ? { badge: "kept" } : {}),
      })),
      selected: shown?.part.id ?? "",
    },
    (id) => ctx.select(id),
    undefined,
  );
  const adds = [];
  const add = (
    /** @type {string} */ label,
    /** @type {(now: Design) => { design: Design, id: string }} */ make,
  ) => {
    const b = el(
      doc,
      "button",
      { type: "button", class: "desk-btn", "data-key": `keys:add:${label}` },
      label,
    );
    b.addEventListener("click", () => ctx.add(make));
    adds.push(b);
  };
  if (!design.primaryKey)
    add("Add primary key", (d) => {
      const made = nextId(d);
      return {
        design: { ...made.design, primaryKey: { id: made.id, name: "", columns: [] } },
        id: made.id,
      };
    });
  add("Add unique", (d) => addPart(d, "uniques"));
  add("Add check", (d) => addPart(d, "checks"));
  let body = el(doc, "p", { class: "td-hint" }, "No keys yet.");
  if (shown) {
    const { list: where, part } = shown;
    const { name, kept, remove } = common(ctx, where, part);
    const parts = [name, ...kept];
    if (!part.kept && (where === "primaryKey" || where === "uniques"))
      parts.push(
        columnsPick(
          doc,
          {
            key: `${where}:${part.id}:cols`,
            label: "Columns",
            ids: /** @type {{ columns: string[] }} */ (part).columns,
            columns,
          },
          (ids) => ctx.set((d) => setPart(d, where, part.id, { columns: ids }), true),
        ),
      );
    if (!part.kept && where === "checks")
      parts.push(
        textField(
          doc,
          {
            key: `checks:${part.id}:expr`,
            label: "Check",
            value: /** @type {{ expression: string }} */ (part).expression,
            placeholder: "total >= 0",
            mono: true,
          },
          (v) => ctx.set((d) => setPart(d, "checks", part.id, { expression: v }), false),
        ),
      );
    body = el(doc, "div", { class: "td-detail" }, ...parts, remove);
  }
  return el(
    doc,
    "div",
    { class: "td-split" },
    el(doc, "div", { class: "td-side" }, list, el(doc, "div", { class: "td-buttons" }, ...adds)),
    body,
  );
}

/** The foreign keys section. */
export function foreignView(/** @type {Ctx} */ ctx) {
  const { doc, design } = ctx;
  const shown = design.foreignKeys.find((f) => f.id === ctx.selected) ?? design.foreignKeys[0];
  const list = itemList(
    doc,
    {
      key: "fks",
      label: "Foreign keys",
      items: design.foreignKeys.map((f) => ({
        id: f.id,
        title: f.name || "(named by the server)",
        detail: f.self
          ? "this table"
          : f.refTable
            ? `${f.refSchema}.${f.refTable}`
            : "references nothing yet",
        ...(f.kept ? { badge: "kept" } : {}),
      })),
      selected: shown?.id ?? "",
      add: "Add foreign key",
    },
    (id) => ctx.select(id),
    () => {
      ctx.add((d) => addPart(d, "foreignKeys", { refSchema: d.schema }));
      ctx.load(design.schema);
    },
  );
  if (!shown)
    return el(
      doc,
      "div",
      { class: "td-split" },
      el(doc, "div", { class: "td-side" }, list),
      el(doc, "p", { class: "td-hint" }, "No foreign keys yet."),
    );
  const fk = shown;
  const put = (/** @type {Record<string, unknown>} */ patch) =>
    ctx.set((d) => setPart(d, "foreignKeys", fk.id, patch), true);
  const { name, kept, remove } = common(ctx, "foreignKeys", fk);
  const parts = [name, ...kept];
  if (!fk.kept) {
    const columns = living(design);
    // A table's option is `t:` and its name, so no name can be taken for this table's.
    const SELF = "self";
    const tables = [
      ...new Set([...(ctx.refs.tables[fk.refSchema] ?? []), ...(fk.refTable ? [fk.refTable] : [])]),
    ];
    const schemas = [...new Set([...ctx.refs.schemas, fk.refSchema].filter(Boolean))];
    const options = [
      ...(fk.refSchema === design.schema
        ? [{ value: SELF, label: `${design.name || "this table"} (this table)` }]
        : []),
      { value: "", label: "Pick a table…" },
      ...tables
        .filter((t) => fk.refSchema !== design.schema || t !== design.name)
        .map((t) => ({ value: `t:${t}`, label: t })),
    ];
    const refColumns = fk.self
      ? columns
      : (ctx.refs.columns[`${fk.refSchema}.${fk.refTable}`] ?? fk.refColumns).map((c) => ({
          id: c,
          name: c,
        }));
    parts.push(
      columnsPick(
        doc,
        { key: `fk:${fk.id}:cols`, label: "Columns", ids: fk.columns, columns },
        (ids) => put({ columns: ids }),
      ),
      el(
        doc,
        "div",
        { class: "td-row" },
        selectField(
          doc,
          {
            key: `fk:${fk.id}:schema`,
            label: "Schema",
            value: fk.refSchema,
            options: schemas.map((s) => ({ value: s, label: s })),
          },
          (v) => {
            put({ refSchema: v, refTable: "", self: false, refColumns: [] });
            ctx.load(v);
          },
        ),
        selectField(
          doc,
          {
            key: `fk:${fk.id}:table`,
            label: "Table",
            value: fk.self ? SELF : fk.refTable ? `t:${fk.refTable}` : "",
            options,
          },
          (v) => {
            const self = v === SELF;
            const table = v.startsWith("t:") ? v.slice(2) : "";
            put({ self, refTable: table, refColumns: [] });
            if (table) ctx.load(fk.refSchema, table);
          },
        ),
      ),
      columnsPick(
        doc,
        { key: `fk:${fk.id}:refs`, label: "References", ids: fk.refColumns, columns: refColumns },
        (ids) => put({ refColumns: ids }),
      ),
      el(
        doc,
        "div",
        { class: "td-row" },
        selectField(
          doc,
          {
            key: `fk:${fk.id}:delete`,
            label: "On delete",
            value: fk.onDelete,
            options: ACTIONS.map((a) => ({ value: a, label: a })),
          },
          (v) => put({ onDelete: v }),
        ),
        selectField(
          doc,
          {
            key: `fk:${fk.id}:update`,
            label: "On update",
            value: fk.onUpdate,
            options: ACTIONS.map((a) => ({ value: a, label: a })),
          },
          (v) => put({ onUpdate: v }),
        ),
      ),
    );
  }
  return el(
    doc,
    "div",
    { class: "td-split" },
    el(doc, "div", { class: "td-side" }, list),
    el(doc, "div", { class: "td-detail" }, ...parts, remove),
  );
}
