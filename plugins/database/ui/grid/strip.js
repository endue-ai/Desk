// The quick filters over the grid, one chip each with Remove, after where they run: "On the
// server" for a table view (they join its WHERE) or "On these rows" for a console's result (they
// keep the rows it holds), and Clear for all of them. Hidden while there is none.

import { el } from "../dom.js";
import { t } from "../strings/index.js";
import { filterLabel } from "./filters.js";

/**
 * @param {Document} doc
 * @param {{ remove(index: number): void, clear(): void }} acts
 */
export function createStrip(doc, acts) {
  const strip = el(doc, "div", {
    class: "grid-strip desk-chips",
    role: "group",
    "aria-label": t("grid.strip.quickFilters"),
    hidden: "",
  });
  strip.addEventListener("click", (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    const remove = target.closest("[data-remove]")?.getAttribute("data-remove");
    if (remove !== null && remove !== undefined) acts.remove(Number(remove));
    else if (target.closest("[data-clear]")) acts.clear();
  });

  return {
    el: strip,
    /**
     * @param {import("./filters.js").Filter[]} filters
     * @param {boolean} server Whether they run on the server (a table view).
     */
    draw(filters, server) {
      strip.hidden = filters.length === 0;
      const chips = filters.map((filter, i) => {
        const label = filterLabel(filter);
        return el(
          doc,
          "span",
          { class: "desk-chip grid-chip" },
          el(doc, "span", {}, label),
          el(
            doc,
            "button",
            {
              type: "button",
              class: "desk-icon-btn",
              "data-remove": String(i),
              "aria-label": t("grid.strip.removeTheFilter", { label: String(label) }),
              title: t("grid.strip.remove"),
            },
            "×",
          ),
        );
      });
      strip.replaceChildren(
        el(
          doc,
          "span",
          { class: "where" },
          server ? t("grid.strip.onTheServer") : t("grid.strip.onTheseRows"),
        ),
        ...chips,
        ...(filters.length > 1
          ? [
              el(
                doc,
                "button",
                { type: "button", class: "desk-btn desk-btn-quiet", "data-clear": "" },
                t("grid.strip.clear"),
              ),
            ]
          : []),
      );
    },
  };
}
