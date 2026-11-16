// The Inspect tab: what docker inspect says, as a tree that folds (the first two levels open), a
// filter on keys and values, and the raw JSON to copy.

import { button, h, icon } from "./dom.js";

/** @typedef {import("./studio.js").App} App */

/** One value of the tree, folded below `open` levels. */
function node(
  /** @type {string} */ key,
  /** @type {unknown} */ value,
  /** @type {number} */ depth,
  /** @type {string} */ filter,
) {
  const label = key ? h("span.jt-key", null, key) : null;
  if (value !== null && typeof value === "object") {
    const entries = Array.isArray(value)
      ? value.map((v, i) => [String(i), v])
      : Object.entries(value);
    const kept = filter ? entries.filter(([k, v]) => contains(k, v, filter)) : entries;
    const summary = Array.isArray(value) ? `[${entries.length}]` : `{${entries.length}}`;
    const details = h(
      "details.jt-node",
      { open: depth < 2 || filter !== "" },
      h("summary", null, label, h("span.jt-sum", null, summary)),
      h(
        "div.jt-children",
        null,
        kept.map(([k, v]) => node(String(k), v, depth + 1, filter)),
      ),
    );
    return details;
  }
  const kind = value === null ? "null" : typeof value;
  return h(
    "div.jt-leaf",
    null,
    label,
    h(`span.jt-value.jt-${kind}`, null, kind === "string" ? JSON.stringify(value) : String(value)),
  );
}

/** Whether a key or anything under it holds the filter. */
function contains(
  /** @type {string} */ key,
  /** @type {unknown} */ value,
  /** @type {string} */ filter,
) {
  if (key.toLowerCase().includes(filter)) return true;
  if (value !== null && typeof value === "object")
    return Object.entries(value).some(([k, v]) => contains(k, v, filter));
  return String(value).toLowerCase().includes(filter);
}

/** @param {App} app @param {unknown} raw @param {string} name */
export function createInspectView(app, raw, name) {
  let filter = "";
  let rawMode = false;
  const host = h("div.jt");
  const box = /** @type {HTMLInputElement} */ (
    h("input.desk-field.jt-filter", {
      type: "search",
      placeholder: "Filter keys and values",
      "aria-label": "Filter",
      onInput: () => {
        filter = box.value.trim().toLowerCase();
        draw();
      },
    })
  );
  const modeBtn = button({
    label: "Raw JSON",
    icon: "file",
    kind: "desk-btn-quiet",
    onClick: () => {
      rawMode = !rawMode;
      modeBtn.setAttribute("aria-pressed", String(rawMode));
      draw();
    },
  });
  const draw = () => {
    if (rawMode) host.replaceChildren(h("pre.code.raw", null, JSON.stringify(raw, null, 2)));
    else host.replaceChildren(node("", raw, 0, filter));
  };
  const element = h(
    "section.inspect-view",
    null,
    h(
      "div.files-bar",
      null,
      h("label.log-search-wrap", null, icon("search", 14), box),
      h("span.grow"),
      modeBtn,
      button({
        label: "Copy the JSON",
        icon: "copy",
        kind: "desk-btn-quiet",
        onClick: () => void app.act.copy(JSON.stringify(raw, null, 2), `the JSON of ${name}`),
      }),
    ),
    host,
  );
  draw();
  return { element, dispose() {} };
}
