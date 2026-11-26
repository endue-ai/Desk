// The usages panel (features/README.md): what was looked for, a sentence of what was found, then two
// lists: what the server's dependency catalog records, and what was read from source (routine
// bodies the catalog does not record, the connection's consoles and the .sql files they are bound
// to). Every row says which it is; a row opens the object's DDL, or the console with the name
// selected. While the read goes on it says so; a failure is said in the panel.

import { el } from "../dom.js";
import { t as messageText } from "../strings/index.js";

/**
 * @typedef {import("./usages.js").Usage} Usage
 * @typedef {{ connection: string, of: string, kind: string, status: "reading" | "done" | "error",
 *   items: Usage[], capped: boolean, error?: string }} UsagesState
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 */

const SOURCES = {
  catalog: "From the server's dependency catalog",
  parsed: "From parsed source",
};

/** What a row says of a usage: its kind, its name, where it is. */
function rowText(/** @type {Usage} */ u) {
  if (u.console) {
    const where = u.file ? `${u.name} · ${u.file}` : u.name;
    return { kind: "console", name: `${where}, line ${u.line ?? 1}`, detail: u.detail ?? "" };
  }
  const name = u.schema ? `${u.schema}.${u.name}` : u.name;
  const routine = u.kind === "function" || u.kind === "procedure";
  const own = routine ? `${name}(${u.detail ?? ""})` : name;
  const on = u.table ? ` on ${u.table}` : "";
  const body =
    u.source === "parsed"
      ? messageText("navigate.usagesPanel.bodyNamesItFirstOnLine", {
          value: String(u.count ?? 1),
          value2: String(u.line ?? 1),
        })
      : "";
  return { kind: u.kind, name: `${own}${on}`, detail: routine ? body : (u.detail ?? "") };
}

/** The sentence over the lists. */
export function summaryOf(/** @type {UsagesState} */ state) {
  if (state.status === "reading")
    return messageText("navigate.usagesPanel.readingTheUsagesOf", { of: String(state.of) });
  if (state.status === "error") return `The usages could not be read: ${state.error ?? "failed"}`;
  const count = (/** @type {string} */ source) =>
    state.items.filter((u) => u.source === source).length;
  const n = state.items.length;
  if (n === 0) return messageText("navigate.usagesPanel.nothingNames", { of: String(state.of) });
  const cut = state.capped ? messageText("navigate.usagesPanel.theServerSListWasCut") : "";
  return `${n} usage${n === 1 ? "" : "s"} of ${state.of}: ${count("catalog")} from the dependency catalog, ${count("parsed")} from parsed source.${cut}`;
}

/**
 * @param {Document} doc
 * @param {UsagesState} state
 * @param {Act} act
 */
export function usagesPanel(doc, state, act) {
  const root = el(doc, "div", { class: "usages", "data-part": "usages" });
  const draw = (/** @type {UsagesState} */ s) => {
    root.replaceChildren(
      el(
        doc,
        "h2",
        { class: "usages-title" },
        messageText("navigate.usagesPanel.usagesOf", { of: String(s.of) }),
      ),
      el(
        doc,
        "p",
        { class: "usages-summary", "aria-live": "polite", "data-part": "summary" },
        summaryOf(s),
      ),
    );
    for (const source of /** @type {const} */ (["catalog", "parsed"])) {
      const items = s.items
        .map((u, i) => /** @type {const} */ ([u, i]))
        .filter(([u]) => u.source === source);
      if (items.length === 0) continue;
      const list = el(doc, "ul", { class: "usages-list", "aria-label": SOURCES[source] });
      for (const [u, i] of items) {
        const t = rowText(u);
        list.append(
          el(
            doc,
            "li",
            {},
            el(
              doc,
              "button",
              { type: "button", class: "desk-btn desk-btn-quiet usage", "data-usage": String(i) },
              el(doc, "span", { class: "usage-kind" }, t.kind),
              el(doc, "span", { class: "usage-name" }, t.name),
              el(doc, "span", { class: "usage-detail" }, t.detail),
              el(doc, "span", { class: "usage-source", "data-source": source }, source),
            ),
          ),
        );
      }
      root.append(
        el(doc, "section", { class: "usages-group" }, el(doc, "h3", {}, SOURCES[source]), list),
      );
    }
  };
  let current = state;
  root.addEventListener("click", (event) => {
    const button = /** @type {HTMLElement | null} */ (
      /** @type {HTMLElement} */ (event.target).closest("[data-usage]")
    );
    const usage = button ? current.items[Number(button.dataset.usage)] : undefined;
    if (usage) act("navigateOpen", current.connection, usage);
  });
  draw(state);
  return {
    el: root,
    update(/** @type {UsagesState} */ next) {
      current = next;
      draw(next);
    },
    destroy() {},
  };
}
