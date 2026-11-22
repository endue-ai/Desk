// The table form's indexes and the table's own fields (PG-51): an index with its name, method (the
// server's), keys (columns or expressions), UNIQUE, a WHERE for a partial one, and CONCURRENTLY for
// a new one on an existing table, which runs after the transaction (said); the table's comment, its
// owner (one of the server's roles), and a new table's partitioning (an existing one's is shown).

import { el } from "../../dom.js";
import { checkField, itemList, keysPick, selectField, textField } from "./bits.js";
import { addPart, existing, removePart, setPart, setPartition, setTable } from "./edits.js";
import { living, PARTITIONS } from "./model.js";

/**
 * @typedef {import("./model.js").Design} Design
 * @typedef {import("./columns-view.js").Ctx & { partitioned: string }} Ctx
 */

const CONCURRENT_WORDS =
  "Builds without blocking writes, after the transaction commits and outside it: if it fails, the rest stays and an invalid index is left to drop.";

/** The indexes section. */
export function indexesView(/** @type {Ctx} */ ctx) {
  const { doc, design } = ctx;
  const shown = design.indexes.find((i) => i.id === ctx.selected) ?? design.indexes[0];
  const list = itemList(
    doc,
    {
      key: "idx",
      label: "Indexes",
      items: design.indexes.map((i) => ({
        id: i.id,
        title: i.name || "(named by the server)",
        detail: [i.method, i.unique ? "unique" : "", i.where ? "partial" : ""]
          .filter(Boolean)
          .join(" · "),
        ...(i.kept ? { badge: "kept" } : i.concurrently ? { badge: "concurrently" } : {}),
      })),
      selected: shown?.id ?? "",
      add: "Add index",
    },
    (id) => ctx.select(id),
    () => {
      const method = ctx.facts.methods.includes("btree") ? "btree" : ctx.facts.methods[0];
      ctx.add((d) => addPart(d, "indexes", { method: method ?? "btree" }));
    },
  );
  if (!shown)
    return el(
      doc,
      "div",
      { class: "td-split" },
      el(doc, "div", { class: "td-side" }, list),
      el(doc, "p", { class: "td-hint" }, "No indexes besides the keys' own."),
    );
  const index = shown;
  const at = (/** @type {string} */ f) => `idx:${index.id}:${f}`;
  const put = (/** @type {Record<string, unknown>} */ patch, redraw = true) =>
    ctx.set((d) => setPart(d, "indexes", index.id, patch), redraw);
  const parts = [
    textField(
      doc,
      { key: at("name"), label: "Name", value: index.name, placeholder: "the server names it" },
      (v) => put({ name: v }, false),
    ),
  ];
  if (index.kept)
    parts.push(
      el(doc, "pre", { class: "td-kept" }, index.kept),
      el(
        doc,
        "p",
        { class: "td-note" },
        "The form does not write this one (DESC, an operator class, INCLUDE, storage options ... ): it is kept as it is. Rename or remove it here; change it in a console.",
      ),
    );
  else {
    const methods = ctx.facts.methods.length ? ctx.facts.methods : [index.method];
    parts.push(
      el(
        doc,
        "div",
        { class: "td-row" },
        selectField(
          doc,
          {
            key: at("method"),
            label: "Method",
            value: index.method,
            options: methods.map((m) => ({ value: m, label: m })),
          },
          (v) => put({ method: v }),
        ),
        checkField(
          doc,
          {
            key: at("unique"),
            label: "Unique",
            checked: index.unique,
            disabled: index.method !== "btree" && !index.unique,
          },
          (v) => put({ unique: v }),
        ),
      ),
      keysPick(
        doc,
        { key: at("keys"), label: "Keys", keys: index.keys, columns: living(design) },
        (keys, redraw) => put({ keys }, redraw),
      ),
      textField(
        doc,
        {
          key: at("where"),
          label: "Where",
          value: index.where,
          placeholder: "deleted_at IS NULL",
          mono: true,
          hint: "A partial index holds only these rows.",
        },
        (v) => put({ where: v }, false),
      ),
    );
    if (ctx.original && !existing(index.id))
      parts.push(
        checkField(
          doc,
          {
            key: at("concurrently"),
            label: "CONCURRENTLY",
            checked: index.concurrently,
            hint: CONCURRENT_WORDS,
          },
          (v) => put({ concurrently: v }),
        ),
      );
  }
  const remove = el(
    doc,
    "button",
    { type: "button", class: "desk-btn desk-btn-danger", "data-key": at("remove") },
    "Remove",
  );
  remove.addEventListener("click", () => {
    ctx.set((d) => removePart(d, "indexes", index.id), false);
    ctx.select("");
  });
  parts.push(el(doc, "div", { class: "td-buttons" }, remove));
  return el(
    doc,
    "div",
    { class: "td-split" },
    el(doc, "div", { class: "td-side" }, list),
    el(doc, "div", { class: "td-detail" }, ...parts),
  );
}

/** The table's own fields: comment, owner, partitioning. */
export function tableView(/** @type {Ctx} */ ctx) {
  const { doc, design, facts } = ctx;
  const parts = [
    textField(
      doc,
      {
        key: "table:comment",
        label: "Comment",
        value: design.comment,
        area: true,
        hint: "Empty leaves none.",
      },
      (v) => ctx.set((d) => setTable(d, { comment: v }), false),
    ),
    textField(
      doc,
      {
        key: "table:owner",
        label: "Owner",
        value: design.owner,
        list: facts.roles,
        placeholder: ctx.original ? "" : "you, when empty",
        hint: "One of the server's roles.",
      },
      (v) => ctx.set((d) => setTable(d, { owner: v }), false),
    ),
  ];
  if (ctx.original)
    parts.push(
      el(
        doc,
        "p",
        { class: "td-note" },
        ctx.partitioned
          ? `Partitioned by ${ctx.partitioned}: a table's partitioning does not change after it is created.`
          : "Not partitioned: a table is partitioned only as it is created.",
      ),
    );
  else {
    const { by, keys } = design.partition;
    parts.push(
      selectField(
        doc,
        {
          key: "table:partition",
          label: "Partition by",
          value: by,
          options: PARTITIONS.map((p) => ({
            value: p,
            label: p ? p.toUpperCase() : "Not partitioned",
          })),
        },
        (v) =>
          ctx.set((d) => {
            const first = living(d)[0];
            return setPartition(d, {
              by: /** @type {Design["partition"]["by"]} */ (v),
              keys:
                v && d.partition.keys.length === 0 && first
                  ? [{ column: first.id, expression: "" }]
                  : d.partition.keys,
            });
          }, true),
      ),
    );
    if (by)
      parts.push(
        keysPick(
          doc,
          { key: "table:partkeys", label: "Partition key", keys, columns: living(design) },
          (next, redraw) => ctx.set((d) => setPartition(d, { keys: next }), redraw),
        ),
        el(
          doc,
          "p",
          { class: "td-note" },
          "Its partitions are created after, each with CREATE TABLE ... PARTITION OF, in a console.",
        ),
      );
  }
  return el(doc, "div", { class: "td-detail td-table" }, ...parts);
}
