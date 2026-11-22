// The table form's columns (PG-51): the list (each with its type, NOT NULL and what the script does
// to it: new, renamed, changed, dropped), and the column shown: its name, a type of the server's with
// its length and array, NOT NULL, the primary key, a default, an identity or a generation, and its
// comment; drop (an existing column stays listed, struck through, with Keep), and up and down for a
// new table's columns. An existing table's columns keep their order, which is said.

import { el } from "../../dom.js";
import { t } from "../../strings/index.js";
import { checkField, itemList, selectField, textField } from "./bits.js";
import {
  addColumn,
  dropColumn,
  existing,
  keepColumn,
  moveColumn,
  setColumn,
  toggleKey,
} from "./edits.js";
import { byId, inPrimaryKey } from "./model.js";

/**
 * @typedef {import("./model.js").Design} Design
 * @typedef {import("./model.js").Column} Column
 * @typedef {{
 *   doc: Document, design: Design, original: Design | null, facts: import("./read.js").Facts,
 *   selected: string, select(id: string): void,
 *   set(edit: (now: Design) => Design, redraw: boolean): void,
 *   add(make: (now: Design) => { design: Design, id: string }): void,
 * }} Ctx
 *   `set` and `add` edit the design as it is when they run (a field typed in since the form was
 *   drawn included); `add` shows the part it made.
 */

const IDENTITIES = () => [
  { value: "", label: t("tableDesign.identityNone") },
  { value: "always", label: t("tableDesign.identityAlways") },
  { value: "by default", label: t("tableDesign.identityByDefault") },
];

/** What the script does to a column, as its list says it. */
function badgeOf(/** @type {Column} */ c, /** @type {Design | null} */ original) {
  if (c.dropped) return t("tableDesign.badgeDropped");
  const was = original
    ? /** @type {Column | undefined} */ (byId(original.columns, c.id))
    : undefined;
  if (!was) return original ? t("tableDesign.badgeNew") : "";
  if (was.name !== c.name) return t("tableDesign.badgeRenamed");
  const same = /** @type {(keyof Column)[]} */ ([
    "type",
    "length",
    "array",
    "nullable",
    "default",
    "identity",
    "generated",
    "comment",
  ]);
  return same.every((k) => String(was[k]).trim() === String(c[k]).trim())
    ? ""
    : t("tableDesign.badgeChanged");
}

/** A column's summary in the list. */
const detailOf = (/** @type {Design} */ d, /** @type {Column} */ c) =>
  [
    `${c.type || t("tableDesign.noType")}${c.length ? `(${c.length})` : ""}${c.array ? "[]" : ""}`,
    inPrimaryKey(d, c.id)
      ? t("tableDesign.pk")
      : !c.nullable || c.identity
        ? t("tableDesign.notNull")
        : "",
  ]
    .filter(Boolean)
    .join(" · ");

/** The column shown. */
function detail(/** @type {Ctx} */ ctx, /** @type {Column} */ c) {
  const { doc, design, facts } = ctx;
  const create = !ctx.original;
  const at = (/** @type {string} */ f) => `col:${c.id}:${f}`;
  const put = (/** @type {Partial<Column>} */ patch, redraw = true) =>
    ctx.set((d) => setColumn(d, c.id, patch), redraw);
  const off = c.dropped === true;
  const pk = inPrimaryKey(design, c.id);
  const valued = Boolean(c.identity || c.generated.trim());
  const parts = [
    textField(
      doc,
      {
        key: at("name"),
        label: t("tableDesign.name"),
        value: c.name,
        disabled: off,
        hint: t("tableDesign.nameHint"),
      },
      (v) => put({ name: v }, false),
    ),
    el(
      doc,
      "div",
      { class: "td-row" },
      textField(
        doc,
        {
          key: at("type"),
          label: t("tableDesign.type"),
          value: c.type,
          list: facts.types.map((type) => type.label),
          placeholder: t("tableDesign.typeExample"),
          disabled: off,
        },
        (v) => put({ type: v }, false),
      ),
      textField(
        doc,
        {
          key: at("length"),
          label: t("tableDesign.length"),
          value: c.length,
          placeholder: "120",
          disabled: off,
        },
        (v) => put({ length: v }, false),
      ),
      checkField(
        doc,
        { key: at("array"), label: t("tableDesign.array"), checked: c.array, disabled: off },
        (v) => put({ array: v }),
      ),
    ),
    el(
      doc,
      "div",
      { class: "td-row" },
      checkField(
        doc,
        {
          key: at("notnull"),
          label: t("tableDesign.notNull"),
          checked: !c.nullable || Boolean(c.identity) || pk,
          disabled: off || pk || Boolean(c.identity),
          ...(pk
            ? { hint: t("tableDesign.inPrimaryKey") }
            : c.identity
              ? { hint: t("tableDesign.identityIs") }
              : {}),
        },
        (v) => put({ nullable: !v }),
      ),
      checkField(
        doc,
        {
          key: at("pk"),
          label: t("tableDesign.primaryKey"),
          checked: pk,
          disabled: off || Boolean(design.primaryKey?.kept),
        },
        (v) => ctx.set((d) => toggleKey(d, c.id, v), true),
      ),
    ),
    textField(
      doc,
      {
        key: at("default"),
        label: t("tableDesign.default"),
        value: c.default,
        placeholder: t("tableDesign.defaultExample"),
        mono: true,
        disabled: off || valued,
        hint: t(valued ? "tableDesign.defaultNone" : "tableDesign.defaultHint"),
      },
      (v) => put({ default: v }, false),
    ),
    el(
      doc,
      "div",
      { class: "td-row" },
      selectField(
        doc,
        {
          key: at("identity"),
          label: t("tableDesign.identity"),
          value: c.identity,
          options: IDENTITIES(),
          disabled: off,
        },
        (v) => put({ identity: /** @type {Column["identity"]} */ (v) }),
      ),
      textField(
        doc,
        {
          key: at("generated"),
          label: t("tableDesign.generated"),
          value: c.generated,
          placeholder: t("tableDesign.generatedExample"),
          mono: true,
          disabled: off || Boolean(c.identity),
          hint: t("tableDesign.generatedHint"),
        },
        (v) => put({ generated: v }, false),
      ),
    ),
    textField(
      doc,
      {
        key: at("comment"),
        label: t("tableDesign.comment"),
        value: c.comment,
        area: true,
        disabled: off,
        hint: t("tableDesign.commentHint"),
      },
      (v) => put({ comment: v }, false),
    ),
  ];
  const buttons = [];
  const button = (
    /** @type {string} */ name,
    /** @type {string} */ label,
    /** @type {() => void} */ on,
    danger = false,
  ) => {
    const b = el(
      doc,
      "button",
      {
        type: "button",
        class: `desk-btn${danger ? " desk-btn-danger" : ""}`,
        "data-key": at(name),
      },
      label,
    );
    b.addEventListener("click", on);
    buttons.push(b);
  };
  // Drop and Keep take each other's place, and the focus with it.
  if (off)
    button("drop", t("tableDesign.keepColumn"), () => ctx.set((d) => keepColumn(d, c.id), true));
  else if (existing(c.id))
    button(
      "drop",
      t("tableDesign.dropColumn"),
      () => ctx.set((d) => dropColumn(d, c.id), true),
      true,
    );
  else
    button("remove", t("tableDesign.removeColumn"), () => {
      ctx.set((d) => dropColumn(d, c.id), false);
      ctx.select("");
    });
  if (create) {
    button("up", t("tableDesign.moveUp"), () => ctx.set((d) => moveColumn(d, c.id, -1), true));
    button("down", t("tableDesign.moveDown"), () => ctx.set((d) => moveColumn(d, c.id, 1), true));
  }
  parts.push(el(doc, "div", { class: "td-buttons" }, ...buttons));
  if (off) parts.unshift(el(doc, "p", { class: "td-note" }, t("tableDesign.dropped")));
  return el(
    doc,
    "div",
    { class: "td-detail", "aria-label": t("tableDesign.column", { name: c.name }) },
    ...parts,
  );
}

/** The columns section. */
export function columnsView(/** @type {Ctx} */ ctx) {
  const { doc, design, original } = ctx;
  const shown = design.columns.find((c) => c.id === ctx.selected) ?? design.columns[0];
  const list = itemList(
    doc,
    {
      key: "cols",
      label: t("tableDesign.columns"),
      items: design.columns.map((c) => ({
        id: c.id,
        title: c.name || t("tableDesign.noName"),
        detail: detailOf(design, c),
        badge: badgeOf(c, original),
        ...(c.dropped ? { struck: true } : {}),
      })),
      selected: shown?.id ?? "",
      add: t("tableDesign.addColumn"),
    },
    (id) => ctx.select(id),
    () => {
      ctx.add((d) => addColumn(d));
    },
  );
  const note = original ? el(doc, "p", { class: "td-note" }, t("tableDesign.order")) : undefined;
  return el(
    doc,
    "div",
    { class: "td-split" },
    el(doc, "div", { class: "td-side" }, list, note),
    shown ? detail(ctx, shown) : el(doc, "p", { class: "td-hint" }, t("tableDesign.addFirst")),
  );
}
