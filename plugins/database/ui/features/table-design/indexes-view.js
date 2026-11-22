// The table form's indexes and the table's own fields (PG-51): an index with its name, method (the
// server's), keys (columns or expressions), UNIQUE, a WHERE for a partial one, and CONCURRENTLY for
// a new one on an existing table, which runs after the transaction (said); the table's comment, its
// owner (one of the server's roles), and a new table's partitioning (an existing one's is shown).

import { el } from "../../dom.js";
import { t } from "../../strings/index.js";
import { checkField, itemList, keysPick, selectField, textField } from "./bits.js";
import { addPart, existing, removePart, setPart, setPartition, setTable } from "./edits.js";
import { living, PARTITIONS } from "./model.js";

/**
 * @typedef {import("./model.js").Design} Design
 * @typedef {import("./columns-view.js").Ctx & { partitioned: string }} Ctx
 */

/** The indexes section. */
export function indexesView(/** @type {Ctx} */ ctx) {
  const { doc, design } = ctx;
  const shown = design.indexes.find((i) => i.id === ctx.selected) ?? design.indexes[0];
  const list = itemList(
    doc,
    {
      key: "idx",
      label: t("tableDesign.indexes"),
      items: design.indexes.map((i) => ({
        id: i.id,
        title: i.name || t("tableDesign.namedByServer"),
        detail: [
          i.method,
          i.unique ? t("tableDesign.detailUnique") : "",
          i.where ? t("tableDesign.detailPartial") : "",
        ]
          .filter(Boolean)
          .join(" · "),
        ...(i.kept
          ? { badge: t("tableDesign.badgeKept") }
          : i.concurrently
            ? { badge: t("tableDesign.badgeConcurrently") }
            : {}),
      })),
      selected: shown?.id ?? "",
      add: t("tableDesign.addIndex"),
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
      el(doc, "p", { class: "td-hint" }, t("tableDesign.noIndexes")),
    );
  const index = shown;
  const at = (/** @type {string} */ f) => `idx:${index.id}:${f}`;
  const put = (/** @type {Record<string, unknown>} */ patch, redraw = true) =>
    ctx.set((d) => setPart(d, "indexes", index.id, patch), redraw);
  const parts = [
    textField(
      doc,
      {
        key: at("name"),
        label: t("tableDesign.name"),
        value: index.name,
        placeholder: t("tableDesign.serverNames"),
      },
      (v) => put({ name: v }, false),
    ),
  ];
  if (index.kept)
    parts.push(
      el(doc, "pre", { class: "td-kept" }, index.kept),
      el(doc, "p", { class: "td-note" }, t("tableDesign.indexKept")),
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
            label: t("tableDesign.method"),
            value: index.method,
            options: methods.map((m) => ({ value: m, label: m })),
          },
          (v) => put({ method: v }),
        ),
        checkField(
          doc,
          {
            key: at("unique"),
            label: t("tableDesign.unique"),
            checked: index.unique,
            disabled: index.method !== "btree" && !index.unique,
          },
          (v) => put({ unique: v }),
        ),
      ),
      keysPick(
        doc,
        {
          key: at("keys"),
          label: t("tableDesign.keys"),
          keys: index.keys,
          columns: living(design),
        },
        (keys, redraw) => put({ keys }, redraw),
      ),
      textField(
        doc,
        {
          key: at("where"),
          label: t("tableDesign.where"),
          value: index.where,
          placeholder: t("tableDesign.whereExample"),
          mono: true,
          hint: t("tableDesign.whereHint"),
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
            label: t("tableDesign.concurrently"),
            checked: index.concurrently,
            hint: t("tableDesign.concurrentHint"),
          },
          (v) => put({ concurrently: v }),
        ),
      );
  }
  const remove = el(
    doc,
    "button",
    { type: "button", class: "desk-btn desk-btn-danger", "data-key": at("remove") },
    t("tableDesign.remove"),
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
        label: t("tableDesign.comment"),
        value: design.comment,
        area: true,
        hint: t("tableDesign.commentHint"),
      },
      (v) => ctx.set((d) => setTable(d, { comment: v }), false),
    ),
    textField(
      doc,
      {
        key: "table:owner",
        label: t("tableDesign.owner"),
        value: design.owner,
        list: facts.roles,
        placeholder: ctx.original ? "" : t("tableDesign.ownerEmpty"),
        hint: t("tableDesign.ownerHint"),
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
          ? t("tableDesign.partitionedBy", { by: ctx.partitioned })
          : t("tableDesign.notPartitionedNote"),
      ),
    );
  else {
    const { by, keys } = design.partition;
    parts.push(
      selectField(
        doc,
        {
          key: "table:partition",
          label: t("tableDesign.partitionBy"),
          value: by,
          options: PARTITIONS.map((p) => ({
            value: p,
            label: p ? p.toUpperCase() : t("tableDesign.notPartitioned"),
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
          {
            key: "table:partkeys",
            label: t("tableDesign.partitionKey"),
            keys,
            columns: living(design),
          },
          (next, redraw) => ctx.set((d) => setPartition(d, { keys: next }), redraw),
        ),
        el(doc, "p", { class: "td-note" }, t("tableDesign.partitionsAfter")),
      );
  }
  return el(doc, "div", { class: "td-detail td-table" }, ...parts);
}
