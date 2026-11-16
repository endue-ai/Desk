// A JSON body as a tree: objects and arrays fold and unfold (with their sizes when folded), the
// first levels open. Each value knows its path, so hovering one offers to copy the path or the
// value, or to capture it as a variable (and, once tests exist, to assert on it).

import { h, icon } from "./dom.js";

/**
 * @typedef {{ onCopy(text: string, said: string): void, onCapture?(path: string): void,
 *   onAssert?(path: string, value: unknown): void }} TreeActions
 */

const LIMIT = 2000;

/** A path's next step, as res.body would read it. @param {string} path @param {string | number} key */
export function childPath(path, key) {
  if (typeof key === "number") return `${path}[${key}]`;
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
}

/** @param {unknown} value */
function scalar(value) {
  if (value === null) return h("span.t-null", null, "null");
  if (typeof value === "string")
    return h(
      "span.t-str",
      { title: value.length > 120 ? value : undefined },
      JSON.stringify(value),
    );
  if (typeof value === "number") return h("span.t-num", null, String(value));
  if (typeof value === "boolean") return h("span.t-bool", null, String(value));
  return h("span", null, String(value));
}

/**
 * Draw a value into a tree.
 * @param {unknown} value @param {TreeActions} actions @param {{ depthOpen?: number }} [options]
 */
export function jsonTree(value, actions, options = {}) {
  const depthOpen = options.depthOpen ?? 2;
  let drawn = 0;

  /** A click that stays on its button. @param {() => void} fn */
  const act = (fn) => (/** @type {MouseEvent} */ e) => {
    e.stopPropagation();
    fn();
  };
  /** @param {string} path @param {unknown} v */
  const tools = (path, v) =>
    h(
      "span.jt-tools",
      null,
      h(
        "button.desk-icon-btn.jt-tool",
        {
          type: "button",
          title: `Copy the path ${path}`,
          "aria-label": "Copy the path",
          onClick: act(() => actions.onCopy(path, "Path copied")),
        },
        icon("link", 12),
      ),
      h(
        "button.desk-icon-btn.jt-tool",
        {
          type: "button",
          title: "Copy the value",
          "aria-label": "Copy the value",
          onClick: act(() =>
            actions.onCopy(typeof v === "string" ? v : JSON.stringify(v, null, 2), "Value copied"),
          ),
        },
        icon("copy", 12),
      ),
      actions.onCapture
        ? h(
            "button.desk-icon-btn.jt-tool",
            {
              type: "button",
              title: "Capture as a variable",
              "aria-label": "Capture as a variable",
              onClick: act(() => actions.onCapture?.(path)),
            },
            icon("variable", 12),
          )
        : null,
      actions.onAssert
        ? h(
            "button.desk-icon-btn.jt-tool",
            {
              type: "button",
              title: "Assert on this value",
              "aria-label": "Assert on this value",
              onClick: act(() => actions.onAssert?.(path, v)),
            },
            icon("test", 12),
          )
        : null,
    );

  /**
   * @param {string | number | undefined} key @param {unknown} v @param {string} path @param {number} depth @param {boolean} last
   * @returns {HTMLElement}
   */
  const node = (key, v, path, depth, last) => {
    drawn++;
    const label =
      key === undefined
        ? null
        : typeof key === "number"
          ? h("span.jt-index", null, `${key}`)
          : h("span.t-key", null, JSON.stringify(key));
    const sep = key === undefined ? null : h("span.t-punct", null, ": ");
    const comma = last ? null : h("span.t-punct", null, ",");
    if (v === null || typeof v !== "object")
      return h("div.jt-row", { dataset: { path } }, label, sep, scalar(v), comma, tools(path, v));
    const isArray = Array.isArray(v);
    const entries = isArray
      ? v.map((x, i) => /** @type {[number, unknown]} */ ([i, x]))
      : Object.entries(/** @type {object} */ (v));
    const [open, close] = isArray ? ["[", "]"] : ["{", "}"];
    const summary = isArray
      ? `${entries.length} item${entries.length === 1 ? "" : "s"}`
      : `${entries.length} key${entries.length === 1 ? "" : "s"}`;
    if (!entries.length)
      return h(
        "div.jt-row",
        { dataset: { path } },
        label,
        sep,
        h("span.t-punct", null, `${open}${close}`),
        comma,
        tools(path, v),
      );
    const children = h("div.jt-children");
    let filled = false;
    const fillChildren = () => {
      if (filled) return;
      filled = true;
      const shown = entries.slice(0, LIMIT);
      children.append(
        ...shown.map(([k, x], i) =>
          node(k, x, childPath(path, k), depth + 1, i === entries.length - 1),
        ),
      );
      if (entries.length > LIMIT)
        children.append(h("div.jt-more", null, `${entries.length - LIMIT} more not drawn`));
    };
    const box = h("div.jt-node", { dataset: { path } });
    const toggle = h(
      "div.jt-row.jt-head",
      {
        onClick: () => {
          const opening = box.classList.contains("is-closed");
          if (opening) fillChildren();
          box.classList.toggle("is-closed", !opening);
        },
      },
      h("span.jt-chev", null, icon("chevronDown", 12)),
      label,
      sep,
      h("span.t-punct", null, open),
      h("span.jt-summary", null, ` ${summary} `),
      h("span.t-punct.jt-close-inline", null, close),
      tools(path, v),
    );
    box.append(
      toggle,
      children,
      h("div.jt-row.jt-foot", null, h("span.t-punct", null, close), comma),
    );
    if (depth < depthOpen && drawn < LIMIT) fillChildren();
    else box.classList.add("is-closed");
    return box;
  };

  const root = h("div.jt", null, node(undefined, value, "res.body", 0, true));
  return {
    el: root,
    /** Open or close every node (opening draws what was not drawn yet, up to the limit). @param {boolean} open */
    all(open) {
      if (!open) {
        for (const n of root.querySelectorAll(".jt-node")) n.classList.add("is-closed");
        return;
      }
      for (let round = 0; round < 40; round++) {
        const closed = /** @type {HTMLElement[]} */ ([
          ...root.querySelectorAll(".jt-node.is-closed"),
        ]);
        if (!closed.length || drawn > LIMIT * 4) break;
        for (const n of closed) {
          const head = n.querySelector(":scope > .jt-head");
          if (head instanceof HTMLElement) head.click();
        }
      }
    },
  };
}
