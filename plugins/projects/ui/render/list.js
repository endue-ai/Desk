// The list and the database view. The list is rows in groups, each row the status, key, title,
// labels, person and due date. The database view is a table of the chosen fields whose headings
// sort it (ascending, descending, then off), with a count and the estimates' sum under it.
import { assigneeTitle } from "../model.js";
import { dueChip, fieldText, h, initials, statusPill } from "./dom.js";

/**
 * @typedef {import("../adapters/common.js").Work} Work
 * @typedef {import("../model.js").Group} Group
 * @typedef {import("./dom.js").CardContext} CardContext
 */

/** One row of the list. */
function row(/** @type {Document} */ doc, /** @type {Work} */ w, /** @type {CardContext} */ c) {
  const who = assigneeTitle(w);
  return h(
    doc,
    "li",
    {
      class: `row ${w.category}`,
      "data-key": w.key,
      tabindex: "-1",
      "aria-current": c.selected === w.key ? "true" : undefined,
    },
    [
      statusPill(doc, w),
      w.ref ? h(doc, "span", { class: "ref", text: w.ref }) : null,
      h(doc, "span", { class: "row-title", text: w.title }),
      h(
        doc,
        "span",
        { class: "labels" },
        w.labels.slice(0, 3).map((l) => h(doc, "span", { class: "label", text: l })),
      ),
      who
        ? h(doc, "span", { class: "avatar", title: who, text: initials(who) })
        : h(doc, "span", { class: "avatar none" }),
      dueChip(doc, w, c.today) ?? h(doc, "span", { class: "due none" }),
    ],
  );
}

/** @param {Document} doc @param {{ groups: Group[] }} body @param {CardContext} c */
export function renderList(doc, body, c) {
  const single =
    body.groups.length === 1 && body.groups[0]?.key === "" && body.groups[0]?.title === "All";
  return h(
    doc,
    "div",
    { class: "list" },
    body.groups.map((group) =>
      h(doc, "section", { class: "group", "aria-label": group.title }, [
        single
          ? null
          : h(doc, "h2", { class: "group-head" }, [
              group.title,
              h(doc, "span", { class: "count", text: String(group.works.length) }),
            ]),
        h(
          doc,
          "ul",
          { class: "rows" },
          group.works.map((w) => row(doc, w, c)),
        ),
      ]),
    ),
  );
}

/**
 * @param {Document} doc
 * @param {{ columns: Array<{ name: string, title: string, sort: "asc" | "desc" | null }>, rows: Work[], estimate: number }} body
 * @param {CardContext} c
 */
export function renderTable(doc, body, c) {
  const head = h(
    doc,
    "tr",
    {},
    body.columns.map((col) =>
      h(
        doc,
        "th",
        {
          scope: "col",
          "aria-sort":
            col.sort === "asc" ? "ascending" : col.sort === "desc" ? "descending" : undefined,
        },
        [
          h(
            doc,
            "button",
            { type: "button", "data-sort": col.name, title: `Sort by ${col.title}` },
            [
              col.title,
              col.sort
                ? h(doc, "span", {
                    class: "arrow",
                    "aria-hidden": "true",
                    text: col.sort === "asc" ? " ↑" : " ↓",
                  })
                : null,
            ],
          ),
        ],
      ),
    ),
  );
  const rows = body.rows.map((w) =>
    h(
      doc,
      "tr",
      {
        class: w.category,
        "data-key": w.key,
        tabindex: "-1",
        "aria-current": c.selected === w.key ? "true" : undefined,
      },
      body.columns.map((col) =>
        h(doc, "td", { class: `f-${col.name}` }, [
          col.name === "status" ? statusPill(doc, w) : fieldText(w, col.name, c.today),
        ]),
      ),
    ),
  );
  const total = `${body.rows.length} ${body.rows.length === 1 ? "task" : "tasks"}${
    body.estimate ? ` · estimate ${Math.round(body.estimate * 100) / 100}` : ""
  }`;
  return h(doc, "table", { class: "db", "aria-label": "Tasks" }, [
    h(doc, "thead", {}, [head]),
    h(doc, "tbody", {}, rows),
    h(doc, "tfoot", {}, [
      h(doc, "tr", {}, [h(doc, "td", { colspan: Math.max(body.columns.length, 1), text: total })]),
    ]),
  ]);
}
