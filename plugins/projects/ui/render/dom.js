// Small DOM helpers the renderers share: an element maker that only ever sets text (a source's
// words never become markup), a card for one piece of work, and a field's text for a cell.
import { CATEGORY_TITLES } from "../adapters/common.js";
import { shortDate } from "../layout/dates.js";
import { assigneeTitle, priorityTitle, sourceTitle } from "../model.js";

/**
 * @typedef {import("../adapters/common.js").Work} Work
 * @typedef {{ today: string, selected: string | null, draggable: boolean }} CardContext
 * @typedef {Record<string, string | number | boolean | undefined>} Attrs
 */

/**
 * An element with attributes and children; `text` sets its text, `class` its classes, `data-*` its
 * dataset, a boolean an attribute that is there or not.
 * @param {Document} doc
 * @param {string} tag
 * @param {Attrs} [attrs]
 * @param {Array<Node | string | null | undefined | false>} [children]
 */
export function h(doc, tag, attrs = {}, children = []) {
  const el = doc.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (name === "text") el.textContent = String(value);
    else el.setAttribute(name, value === true ? "" : String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === "string" ? doc.createTextNode(child) : child);
  }
  return el;
}

/** Initials for an avatar: "Ada Lovelace" → "AL", "mina@example.com" → "M". */
export function initials(/** @type {string} */ who) {
  const name = who.includes("@") ? (who.split("@")[0] ?? "") : who;
  const parts = name.split(/[\s._-]+/).filter(Boolean);
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

/** Whether open work is past its due date. */
export const isLate = (/** @type {Work} */ w, /** @type {string} */ today) =>
  Boolean(w.due && w.due < today && w.category !== "done" && w.category !== "cancelled");

/** A due date as a chip's text and whether it is late. */
export function dueChip(
  /** @type {Document} */ doc,
  /** @type {Work} */ w,
  /** @type {string} */ today,
) {
  if (!w.due) return null;
  const late = isLate(w, today);
  return h(doc, "span", {
    class: late ? "due late" : "due",
    title: late ? `Late: due ${w.due}` : `Due ${w.due}`,
    text: shortDate(w.due, today),
  });
}

/** One piece of work as a card on the board, the swimlanes or the calendar. */
export function card(
  /** @type {Document} */ doc,
  /** @type {Work} */ w,
  /** @type {CardContext} */ c,
  compact = false,
) {
  const who = assigneeTitle(w);
  const priority = priorityTitle(w);
  const head = h(doc, "div", { class: "card-head" }, [
    w.ref ? h(doc, "span", { class: "ref", text: w.ref }) : null,
    h(doc, "span", { class: `system ${w.system}`, text: sourceTitle(w) }),
  ]);
  const meta = h(doc, "div", { class: "card-meta" }, [
    w.priority !== null
      ? h(doc, "span", {
          class: `priority p${w.priority}`,
          title: `Priority: ${priority}`,
          text: priority,
        })
      : null,
    dueChip(doc, w, c.today),
    w.estimate !== undefined
      ? h(doc, "span", { class: "estimate", title: "Estimate", text: String(w.estimate) })
      : null,
    who ? h(doc, "span", { class: "avatar", title: who, text: initials(who) }) : null,
  ]);
  const labels = w.labels.length
    ? h(
        doc,
        "div",
        { class: "labels" },
        w.labels.slice(0, 4).map((l) => h(doc, "span", { class: "label", text: l })),
      )
    : null;
  return h(
    doc,
    "article",
    {
      class: `card ${w.category}${compact ? " compact" : ""}`,
      "data-key": w.key,
      "data-category": w.category,
      tabindex: "-1",
      draggable: c.draggable ? "true" : undefined,
      "aria-current": c.selected === w.key ? "true" : undefined,
      "aria-label": `${w.ref ? `${w.ref} ` : ""}${w.title}, ${w.status}`,
    },
    compact
      ? [h(doc, "span", { class: "card-title", text: w.ref ? `${w.ref} ${w.title}` : w.title })]
      : [head, h(doc, "p", { class: "card-title", text: w.title }), labels, meta],
  );
}

/** A status as a pill coloured by its category. */
export const statusPill = (/** @type {Document} */ doc, /** @type {Work} */ w) =>
  h(doc, "span", {
    class: `pill ${w.category}`,
    title: CATEGORY_TITLES[w.category],
    text: w.status,
  });

/** A field's text for a cell of the database view or a row of the list. */
export function fieldText(
  /** @type {Work} */ w,
  /** @type {string} */ name,
  /** @type {string} */ today,
) {
  switch (name) {
    case "ref":
      return w.ref;
    case "title":
      return w.title;
    case "status":
      return w.status;
    case "category":
      return CATEGORY_TITLES[w.category];
    case "assignee":
      return assigneeTitle(w);
    case "priority":
      return priorityTitle(w);
    case "labels":
      return w.labels.join(", ");
    case "start":
    case "due":
      return shortDate(w[name], today);
    case "estimate":
      return w.estimate === undefined ? "" : String(w.estimate);
    case "source":
      return sourceTitle(w);
    case "updated":
      return shortDate(w.updatedAt.slice(0, 10), today);
    default:
      return String(/** @type {Record<string, unknown>} */ (w)[name] ?? "");
  }
}
