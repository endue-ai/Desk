// The DOM of a terminal tab's split panes (issue 315): one panel per tab (the tab strip's tabpanel) holding
// its panes, each placed in percent of the panel from the layout's boxes (layout.js), and a divider
// on every split. Dragging a divider asks for the split's new ratio; the layout comes back through
// `arrange`, and the view refits the tab's terminals, whose new sizes reach their PTYs.
import { boxes, dividers } from "./layout.js";

/**
 * @typedef {import("./layout.js").Layout} Layout
 * @typedef {import("./layout.js").Min} Min
 * @typedef {{
 *   ratio(tab: string, path: string, ratio: number, min: Min): unknown,
 *   min(tab: string): Min,
 * }} SplitActions
 */

const percent = (/** @type {number} */ fraction) => `${Math.round(fraction * 1e4) / 100}%`;

/**
 * @param {Document} doc
 * @param {HTMLElement} root the panes' container (#panes)
 * @param {SplitActions} actions
 */
export function createSplits(doc, root, actions) {
  /** @type {Map<string, HTMLElement>} */
  const panels = new Map();

  /** A divider for one split: a separator a pointer drags along the split's axis. */
  const divider = (
    /** @type {string} */ tab,
    /** @type {HTMLElement} */ panel,
    /** @type {import("./layout.js").Divider} */ d,
  ) => {
    const el = doc.createElement("div");
    el.className = "pane-divider";
    el.dataset.path = d.path;
    el.dataset.split = d.split;
    el.setAttribute("role", "separator");
    el.setAttribute("aria-orientation", d.split === "right" ? "vertical" : "horizontal");
    el.setAttribute("aria-valuenow", String(Math.round(d.at * 100)));
    const { box } = d;
    if (d.split === "right") {
      Object.assign(el.style, {
        left: percent(box.x + box.width * d.at),
        top: percent(box.y),
        height: percent(box.height),
      });
    } else {
      Object.assign(el.style, {
        left: percent(box.x),
        top: percent(box.y + box.height * d.at),
        width: percent(box.width),
      });
    }
    /** @type {number | null} */
    let dragging = null;
    const along = (/** @type {MouseEvent} */ event) => {
      const rect = panel.getBoundingClientRect();
      return d.split === "right"
        ? ((event.clientX - rect.left) / (rect.width || 1) - box.x) / (box.width || 1)
        : ((event.clientY - rect.top) / (rect.height || 1) - box.y) / (box.height || 1);
    };
    el.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      dragging = /** @type {PointerEvent} */ (event).pointerId ?? 1;
      el.setPointerCapture?.(dragging);
      el.classList.add("is-dragging");
    });
    el.addEventListener("pointermove", (event) => {
      if (dragging === null) return;
      actions.ratio(tab, d.path, along(event), actions.min(tab));
    });
    const stop = () => {
      if (dragging === null) return;
      el.releasePointerCapture?.(dragging);
      dragging = null;
      el.classList.remove("is-dragging");
    };
    el.addEventListener("pointerup", stop);
    el.addEventListener("pointercancel", stop);
    return el;
  };

  return {
    /** The tab's panel, made the first time; the strip's tab `label` names it. */
    panel(/** @type {string} */ tab) {
      const had = panels.get(tab);
      if (had) return had;
      const panel = doc.createElement("div");
      panel.className = "tab-panel";
      panel.id = `panel-${tab}`;
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", `tab-${tab}`);
      panel.hidden = true;
      root.append(panel);
      panels.set(tab, panel);
      return panel;
    },
    /** Place `tab`'s panes as `layout` says and draw its dividers; a drag in progress ends. */
    arrange(
      /** @type {string} */ tab,
      /** @type {Layout} */ layout,
      /** @type {(id: string) => HTMLElement | undefined} */ paneOf,
    ) {
      const panel = this.panel(tab);
      const split = !("pane" in layout);
      panel.classList.toggle("is-split", split);
      for (const [id, box] of Object.entries(boxes(layout))) {
        const pane = paneOf(id);
        if (!pane) continue;
        Object.assign(pane.style, {
          left: percent(box.x),
          top: percent(box.y),
          width: percent(box.width),
          height: percent(box.height),
        });
      }
      // A divider being dragged stays (it holds the pointer); only its place changes.
      const lines = dividers(layout);
      const old = [...panel.querySelectorAll(":scope > .pane-divider")];
      const keep = old.find((el) => el.classList.contains("is-dragging"));
      for (const el of old) if (el !== keep) el.remove();
      for (const d of lines) {
        const fresh = divider(tab, panel, d);
        if (keep && keep instanceof HTMLElement && keep.dataset.path === d.path) {
          keep.style.cssText = fresh.style.cssText;
          keep.setAttribute("aria-valuenow", fresh.getAttribute("aria-valuenow") ?? "");
          continue;
        }
        panel.append(fresh);
      }
      if (keep && !lines.some((d) => d.path === /** @type {HTMLElement} */ (keep).dataset.path))
        keep.remove();
    },
    /** Show `tab`'s panel and hide the others. */
    show(/** @type {string} */ tab) {
      for (const [id, panel] of panels) panel.hidden = id !== tab;
    },
    /** Forget the tab's panel, once its last pane has gone. */
    remove(/** @type {string} */ tab) {
      panels.get(tab)?.remove();
      panels.delete(tab);
    },
    /** Whether the tab's panel is on screen. */
    visible: (/** @type {string} */ tab) => panels.get(tab)?.hidden === false,
  };
}
