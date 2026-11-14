// The launcher's DOM: the field, the Recent row and the grid of every plugin.

/**
 * @typedef {import("./model.js").Tile} Tile
 * @param {Document} doc
 * @param {{ type(text: string): void, move(step: "left" | "right" | "up" | "down"): void,
 *   launch(id?: string): void, close(): void }} on
 */
export function createView(doc, on) {
  const el = (id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const find = /** @type {HTMLInputElement} */ (el("find"));
  const [recentGroup, recent, all, none, status] = [
    "recent-group",
    "recent",
    "all",
    "none",
    "status",
  ].map(el);
  const hint = status.textContent ?? "";
  const ARROWS = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };

  find.addEventListener("input", () => on.type(find.value));
  doc.addEventListener("keydown", (event) => {
    const step = ARROWS[event.key];
    // Left and right stay the field's while it holds text: they move its caret.
    const caret = (step === "left" || step === "right") && find.value !== "";
    if (step && !caret) {
      event.preventDefault();
      on.move(step);
    } else if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      on.launch();
    } else if (event.key === "Escape") {
      event.preventDefault();
      on.close();
    }
  });
  // A press on the ground around the grid puts the launcher away.
  doc.addEventListener("click", (event) => {
    const at = /** @type {Element | null} */ (event.target);
    if (!at?.closest("button, input, label")) on.close();
  });

  /** @param {Tile} tile @param {string | undefined} selected */
  const button = (tile, selected) => {
    const b = doc.createElement("button");
    b.type = "button";
    b.className = "desk-btn tile";
    b.dataset.plugin = tile.id;
    b.tabIndex = -1;
    b.setAttribute("aria-selected", String(tile.id === selected));
    if (!tile.available) {
      b.setAttribute("aria-disabled", "true");
      b.title = tile.reason ?? "";
    }
    const initial = doc.createElement("span");
    initial.className = "initial";
    initial.setAttribute("aria-hidden", "true");
    initial.textContent = tile.initial;
    const name = doc.createElement("span");
    name.className = "name";
    name.textContent = tile.name;
    b.append(initial, name);
    b.addEventListener("click", () => on.launch(tile.id));
    return b;
  };

  return {
    /** @param {{ recent: Tile[], all: Tile[], selected: string | undefined, typed: string }} s */
    draw(s) {
      if (find.value !== s.typed) find.value = s.typed;
      recentGroup.hidden = s.recent.length === 0;
      recent.replaceChildren(...s.recent.map((t) => button(t, s.selected)));
      // A plugin in the Recent row is selected there, not a second time below.
      const below = s.recent.some((t) => t.id === s.selected) ? undefined : s.selected;
      all.replaceChildren(...s.all.map((t) => button(t, below)));
      none.hidden = s.all.length > 0;
      doc.querySelector('.tile[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" });
    },
    status(text) {
      status.textContent = text || hint;
    },
    focus() {
      find.focus();
    },
    /** How many tiles a row of the grid holds now. */
    columns() {
      const tops = [...all.children].map((c) => /** @type {HTMLElement} */ (c).offsetTop);
      const row = tops.filter((top) => top === tops[0]).length;
      return Math.max(1, row);
    },
  };
}
