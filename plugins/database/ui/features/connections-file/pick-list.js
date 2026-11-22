// The ticked list both dialogs share (PG-15): a row per item with its checkbox, All and None, and
// the count; a change calls `follow` so the dialog can say what the ticks make.

import { el } from "../../dom.js";

/**
 * @param {Document} doc
 * @param {{ label: string, rows: { node: HTMLElement, box: HTMLInputElement }[], count(n: number): string, follow(): void }} spec
 */
export function pickList(doc, spec) {
  const count = el(doc, "span", { class: "hint", "data-part": "count" });
  const boxes = spec.rows.map((r) => r.box).filter((b) => !b.disabled);
  const ticks = () => boxes.filter((b) => b.checked).length;
  const update = () => {
    count.textContent = spec.count(ticks());
    spec.follow();
  };
  const button = (/** @type {string} */ text, /** @type {boolean} */ on) => {
    const node = el(
      doc,
      "button",
      { type: "button", class: "desk-btn desk-btn-quiet", "data-ctl": on ? "all" : "none" },
      text,
    );
    node.addEventListener("click", () => {
      for (const box of boxes) box.checked = on;
      update();
    });
    return node;
  };
  for (const box of boxes) box.addEventListener("change", update);
  const node = el(
    doc,
    "fieldset",
    { class: "connections-pick" },
    el(doc, "legend", {}, spec.label),
    el(doc, "p", { class: "connections-tools" }, button("All", true), button("None", false), count),
    el(
      doc,
      "div",
      { class: "connections-rows", role: "group", "aria-label": spec.label },
      ...spec.rows.map((r) => r.node),
    ),
  );
  return { node, ticks, update };
}

/** A checkbox row: the box, the name, and what follows it. */
export function checkRow(
  /** @type {Document} */ doc,
  /** @type {{ value: string, name: string, on: boolean, off?: boolean, kind?: string }} */ row,
  /** @type {(Node | string | undefined)[]} */ ...after
) {
  const box = /** @type {HTMLInputElement} */ (
    el(doc, "input", { type: "checkbox", class: "desk-check", value: row.value })
  );
  box.checked = row.on;
  box.disabled = row.off === true;
  const node = el(
    doc,
    "label",
    { class: "check connections-row", ...(row.kind ? { "data-kind": row.kind } : {}) },
    box,
    el(doc, "span", { class: "connections-name" }, row.name),
    ...after,
  );
  return { node, box };
}
