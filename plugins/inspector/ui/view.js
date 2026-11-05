// The inspector's DOM: the sections as a tablist (arrow keys, Home, End), the filter (`/` to reach
// it, Escape to clear it), each group as a table with a caption, and the export in a dialog that
// takes the focus and gives it back. The words come from the model.

/**
 * @typedef {import("./sections.js").Section} Section
 * @typedef {import("./model.js").Table} Table
 * @typedef {{ show(section: Section): void, filter(query: string): void, exportJson(): void }} Actions
 */

/**
 * @param {Document} doc
 * @param {Actions} actions
 */
export function createView(doc, actions) {
  const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const bar = byId("bar");
  const tablist = byId("sections");
  const filter = /** @type {HTMLInputElement} */ (byId("filter"));
  const exportButton = byId("export");
  const panel = byId("panel");
  const summary = byId("summary");
  const groups = byId("groups");
  const dialog = byId("export-panel");
  const text = /** @type {HTMLTextAreaElement} */ (byId("export-text"));
  const status = byId("status");

  /**
   * @param {string} tag
   * @param {Record<string, unknown>} [props]
   * @param {Array<Node | string>} children
   */
  const el = (tag, props = {}, ...children) => {
    const node = doc.createElement(tag);
    Object.assign(node, props);
    node.append(...children);
    return node;
  };
  const tabs = () =>
    [...tablist.querySelectorAll("[role=tab]")].map((t) => /** @type {HTMLElement} */ (t));
  const tabOf = (/** @type {string} */ id) => tabs().find((t) => t.dataset.section === id);

  tablist.addEventListener("click", (event) => {
    const tab = /** @type {HTMLElement} */ (event.target).closest("[role=tab]");
    if (tab instanceof HTMLElement && tab.dataset.section)
      actions.show(/** @type {Section} */ (tab.dataset.section));
  });

  tablist.addEventListener("keydown", (event) => {
    const all = tabs();
    const at = all.indexOf(/** @type {HTMLElement} */ (doc.activeElement));
    if (at < 0) return;
    const to = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: all.length - 1 }[event.key];
    if (to === undefined) return;
    event.preventDefault();
    const next = all[(to + all.length) % all.length];
    const id = /** @type {Section} */ (next?.dataset.section);
    actions.show(id);
    tabOf(id)?.focus();
  });

  filter.addEventListener("input", () => actions.filter(filter.value));

  exportButton.addEventListener("click", () => actions.exportJson());

  const closeExport = () => {
    dialog.hidden = true;
    bar.inert = false;
    panel.inert = false;
    exportButton.focus();
  };
  byId("close").addEventListener("click", closeExport);
  byId("copy").addEventListener("click", async () => {
    text.focus();
    text.select();
    try {
      await doc.defaultView?.navigator.clipboard.writeText(text.value);
      status.textContent = "Copied the JSON.";
    } catch {
      // A frame without a gesture or the clipboard API: the text is selected to copy by hand.
      status.textContent = "The JSON is selected: copy it with the keyboard.";
    }
  });

  doc.addEventListener("keydown", (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    if (!dialog.hidden) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeExport();
      } else if (event.key === "Tab") keepFocusIn(event);
      return;
    }
    if (event.key === "/" && !target.closest?.("input, textarea")) {
      event.preventDefault();
      filter.focus();
    } else if (event.key === "Escape" && target === filter && filter.value !== "") {
      event.preventDefault();
      filter.value = "";
      actions.filter("");
    }
  });

  /** Tab and Shift+Tab stay inside the export dialog while it is open. */
  const keepFocusIn = (/** @type {KeyboardEvent} */ event) => {
    const stops = [text, ...dialog.querySelectorAll("button")];
    const first = stops[0];
    const last = stops[stops.length - 1];
    const active = doc.activeElement;
    if (!dialog.contains(active) || (event.shiftKey ? active === first : active === last)) {
      event.preventDefault();
      /** @type {HTMLElement | undefined} */ (event.shiftKey ? last : first)?.focus();
    }
  };

  /** @param {import("./model.js").Group} group */
  const tableOf = (group) => {
    const head = el("tr", {}, ...group.columns.map((c) => el("th", { scope: "col" }, c)));
    const rows = group.rows.map((row) => el("tr", {}, ...row.map((cell) => el("td", {}, cell))));
    if (rows.length === 0) {
      const none = el("td", { className: "none", colSpan: group.columns.length }, "None");
      rows.push(el("tr", {}, none));
    }
    return el(
      "table",
      {},
      el("caption", {}, group.title),
      el("thead", {}, head),
      el("tbody", {}, ...rows),
    );
  };

  return {
    /**
     * @param {Array<{ id: Section, label: string }>} list
     * @param {Section} current
     */
    sections(list, current) {
      if (
        tabs()
          .map((t) => t.dataset.section)
          .join() !== list.map((s) => s.id).join()
      ) {
        tablist.replaceChildren(
          ...list.map((s) => {
            const tab = el("button", { type: "button", id: `tab-${s.id}`, className: "desk-tab" }, s.label);
            tab.setAttribute("role", "tab");
            tab.setAttribute("aria-controls", "panel");
            tab.dataset.section = s.id;
            return tab;
          }),
        );
      }
      for (const tab of tabs()) {
        const selected = tab.dataset.section === current;
        tab.setAttribute("aria-selected", String(selected));
        tab.tabIndex = selected ? 0 : -1;
      }
      panel.setAttribute("aria-labelledby", `tab-${current}`);
    },

    /** @param {Pick<Table, "summary" | "groups">} table */
    table(table) {
      summary.textContent = table.summary;
      groups.replaceChildren(...table.groups.map(tableOf));
    },

    /** @param {string} message */
    status(message) {
      status.textContent = message;
    },

    /** @param {string} json */
    exported(json) {
      text.value = json;
      dialog.hidden = false;
      bar.inert = true;
      panel.inert = true;
      text.focus();
      text.setSelectionRange(0, 0);
      status.textContent = "";
    },
  };
}
