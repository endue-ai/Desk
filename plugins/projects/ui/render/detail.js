// The open work's details beside the view: its key and source, its title, the status, priority and
// dates the person can change when its connector provides task.move and task.update, the rest as
// facts, its text, and a button to its original on the web.
import { PRIORITY_TITLES } from "../adapters/common.js";
import { systemTitle } from "../adapters/index.js";
import { h } from "./dom.js";

/**
 * @typedef {import("../present.js").Detail} Detail
 * @typedef {{ command(id: string, args?: Record<string, unknown>): unknown, close(): unknown }} Actions
 */

/** A select of choices, the current one picked. */
function choice(
  /** @type {Document} */ doc,
  /** @type {string} */ field,
  /** @type {Array<[string, string]>} */ options,
  /** @type {string} */ current,
  /** @type {boolean} */ enabled,
) {
  const select = /** @type {HTMLSelectElement} */ (
    h(
      doc,
      "select",
      { "data-field": field, disabled: !enabled },
      options.map(([value, text]) => h(doc, "option", { value, text })),
    )
  );
  select.value = current;
  return select;
}

/** @param {Document} doc @param {HTMLElement} aside @param {Detail | null} detail @param {Actions} actions */
export function renderDetail(doc, aside, detail, actions) {
  aside.replaceChildren();
  aside.hidden = detail === null;
  if (!detail) return;
  const w = detail.work;
  const statuses = detail.statuses.includes(w.status)
    ? detail.statuses
    : [w.status, ...detail.statuses];
  const status = choice(
    doc,
    "status",
    statuses.map((s) => [s, s]),
    w.status,
    detail.canMove,
  );
  status.addEventListener("change", () =>
    actions.command("endue.projects.move", { status: status.value }),
  );
  const priority = choice(
    doc,
    "priority",
    PRIORITY_TITLES.map((t, i) => [String(i), i === 0 ? "None" : t]),
    String(w.priority ?? 0),
    detail.canUpdate,
  );
  priority.addEventListener("change", () =>
    actions.command("endue.projects.update", {
      priority: priority.value === "0" ? null : Number(priority.value),
    }),
  );
  /** A date field that clears to null. */
  const date = (/** @type {"start" | "due"} */ field) => {
    const input = /** @type {HTMLInputElement} */ (
      h(doc, "input", {
        type: "date",
        "data-field": field,
        value: w[field] ?? "",
        disabled: !detail.canUpdate,
      })
    );
    input.addEventListener("change", () =>
      actions.command("endue.projects.update", { [field]: input.value || null }),
    );
    return input;
  };
  const why =
    detail.canMove && detail.canUpdate
      ? null
      : h(doc, "p", {
          class: "hint",
          text: `${detail.source} provides no ${[detail.canMove ? "" : "task.move", detail.canUpdate ? "" : "task.update"].filter(Boolean).join(" or ")}: changes happen in ${systemTitle(w.system, w.source.connector)}.`,
        });
  const close = h(doc, "button", {
    type: "button",
    class: "close",
    "aria-label": "Close",
    title: "Close (Escape)",
    text: "×",
  });
  close.addEventListener("click", () => actions.close());
  const original = w.url
    ? h(doc, "button", {
        type: "button",
        class: "original",
        title: "Open the original (o)",
        text: `Open in ${systemTitle(w.system, w.source.connector)}`,
      })
    : null;
  original?.addEventListener("click", () => actions.command("endue.projects.open-original", {}));
  aside.append(
    h(doc, "header", {}, [
      w.ref ? h(doc, "span", { class: "ref", text: w.ref }) : null,
      h(doc, "span", { class: `system ${w.system}`, text: detail.source }),
      close,
    ]),
    h(doc, "h2", { id: "detail-title", text: w.title }),
    h(doc, "div", { class: "edit" }, [
      h(doc, "label", {}, ["Status", status]),
      h(doc, "label", {}, ["Priority", priority]),
      h(doc, "label", {}, ["Start", date("start")]),
      h(doc, "label", {}, ["Due", date("due")]),
    ]),
    why ?? "",
    h(
      doc,
      "dl",
      {},
      detail.facts.flatMap((f) => [
        h(doc, "dt", { text: f.title }),
        h(doc, "dd", { text: f.text }),
      ]),
    ),
    w.body ? h(doc, "p", { class: "body", text: w.body }) : "",
    original ?? "",
  );
}
