// A name's card as the editor shows it over the name (hover, or Alt+F12 at the caret): its kind and
// qualified name, its comment, the row estimate, then a relation's columns (type, key, default) and
// keys, a routine's overloads, or a column's type and default. A status a screen reader reads.

import { el } from "../dom.js";
import { t } from "../strings/index.js";

/** @typedef {import("./card.js").Card} Card */

/** The card's element. */
export function renderCard(/** @type {Document} */ doc, /** @type {Card} */ card) {
  const head = el(
    doc,
    "div",
    { class: "nav-card-head" },
    el(doc, "span", { class: "nav-card-kind" }, card.kind),
    el(doc, "span", { class: "nav-card-title" }, card.title),
  );
  const root = el(doc, "div", { class: "nav-card", role: "status", "aria-live": "polite" }, head);
  const line = (/** @type {string} */ cls, /** @type {string} */ text) =>
    root.append(el(doc, "div", { class: cls }, text));
  if (card.type)
    line(
      "nav-card-type",
      `${card.type}${card.notNull ? t("card.notNull") : ""}${card.default ? t("card.default", { value: card.default }) : ""}`,
    );
  if (card.detail) line("nav-card-detail", card.detail);
  if (card.comment) line("nav-card-comment", card.comment);
  if (card.estimate !== undefined)
    line("nav-card-detail", t("card.estimate", { count: card.estimate }));
  if (card.columns) {
    const rows = card.columns.map((c) =>
      el(
        doc,
        "tr",
        {},
        el(doc, "td", { class: "nav-card-col" }, c.name),
        el(doc, "td", { class: "nav-card-coltype" }, c.type),
        el(
          doc,
          "td",
          { class: "nav-card-key" },
          [c.key, c.default && t("card.columnDefault", { value: c.default })]
            .filter(Boolean)
            .join(" · "),
        ),
      ),
    );
    root.append(el(doc, "table", { class: "nav-card-columns" }, el(doc, "tbody", {}, ...rows)));
    if (card.more) line("nav-card-detail", t("card.more", { more: String(card.more) }));
  }
  for (const key of card.keys ?? []) line("nav-card-keys", key);
  for (const s of card.signatures ?? []) {
    line("nav-card-signature", s.text);
    if (s.comment) line("nav-card-comment", s.comment);
  }
  return root;
}
