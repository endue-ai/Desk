// The one box the features' panels draw in (#panel-box, feature-host.js). A panel buffer on screen
// is drawn by its type's module: again when another buffer or a new state of one without `update`
// comes, in place through `update` otherwise. Another kind of buffer hides the box but keeps what
// it holds, so a panel shown again is as it was (its scroll too); a panel goes, with `destroy`,
// when another panel is drawn or its buffer closes. The box is named by the panel's label.

/**
 * @typedef {import("./feature-host.js").Panel} Panel
 * @typedef {import("./feature-host.js").PanelHandle} PanelHandle
 * @typedef {import("./consoles.js").Console} Console
 * @typedef {(action: string, ...args: unknown[]) => unknown} Act
 */

/**
 * @param {Document} doc
 * @param {HTMLElement} box
 * @param {Record<string, Panel>} panels by type
 * @param {Act} act
 */
export function createPanelBox(doc, box, panels, act) {
  /** @type {{ id: string, state: unknown, handle: PanelHandle } | null} */
  let drawn = null;
  const clear = () => {
    drawn?.handle.destroy?.();
    drawn = null;
    box.replaceChildren();
  };

  return {
    /** Draw the buffer on screen when it is a panel; hide the box when it is not. */
    draw(/** @type {Console | null} */ model) {
      const panel = model && Object.hasOwn(panels, model.kind) ? panels[model.kind] : undefined;
      box.hidden = !panel;
      if (!model || !panel) return;
      const state = model[model.kind];
      if (drawn?.id === model.id && drawn.state === state) return;
      if (drawn?.id === model.id && drawn.handle.update) {
        drawn.handle.update(state);
        drawn.state = state;
        return;
      }
      clear();
      const buffer = { id: model.id, connection: model.connection, name: model.name };
      const made = panel.render(doc, state, act, buffer);
      const handle = "nodeType" in made ? { el: made } : made;
      box.setAttribute("aria-label", panel.label);
      box.replaceChildren(handle.el);
      drawn = { id: model.id, state, handle };
    },
    /** A buffer closed: its panel goes. */
    closed(/** @type {string} */ id) {
      if (drawn?.id === id) clear();
    },
  };
}

/**
 * Link each feature's stylesheets once, after the page's own.
 * @param {Document} doc
 * @param {{ styles?: string[] }[]} features
 */
export function linkStyles(doc, features) {
  for (const href of features.flatMap((f) => f.styles ?? [])) {
    if ([...doc.head.querySelectorAll("link")].some((l) => l.getAttribute("href") === href))
      continue;
    const link = doc.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    doc.head.append(link);
  }
}
