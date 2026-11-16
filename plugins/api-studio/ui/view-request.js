// The request's half of a tab: its sections as tabs (Params, Body, Headers, Auth, Vars, Scripts,
// Assert, Tests, Docs, Settings), each with a count or a dot when it holds something, and the
// section in front. Other files draw the sections; this one only switches between them.

import { h } from "./dom.js";
import { active } from "./model.js";

/**
 * @typedef {import("./app.js").Tab} Tab
 * @typedef {import("./studio.js").Studio} Studio
 * @typedef {{ id: string, label: string, badge?(tab: Tab): number | boolean,
 *   draw(S: Studio, tab: Tab): { el: HTMLElement, syncUrl?(): void, redraw?(): void } }} Section
 */

/** @type {Section[]} */
export const SECTIONS = [];

/** The order sections stand in, whichever file brings them first. */
const ORDER = [
  "params",
  "body",
  "headers",
  "auth",
  "vars",
  "scripts",
  "assert",
  "tests",
  "docs",
  "settings",
];

/** Add the sections a feature brings. @param {Section[]} list */
export function addSections(list) {
  for (const s of list) {
    const at = SECTIONS.findIndex((o) => o.id === s.id);
    if (at >= 0) SECTIONS[at] = s;
    else SECTIONS.push(s);
  }
  const rank = (/** @type {string} */ id) =>
    ORDER.includes(id) ? ORDER.indexOf(id) : ORDER.length;
  SECTIONS.sort((a, b) => rank(a.id) - rank(b.id));
}

/** How many rows count in a request's list. @param {import("./model.js").Pair[]} list */
export const counted = (list) => active(list).length;

/** @param {Studio} S @param {Tab} tab */
export function requestPane(S, tab) {
  const strip = h("div.desk-tabs.as-subtabs", {
    role: "tablist",
    "aria-label": "Request sections",
  });
  const panel = h("div.as-subpanel", { role: "tabpanel" });
  /** @type {ReturnType<Section["draw"]> | undefined} */
  let shown;

  const drawStrip = () => {
    strip.replaceChildren(
      ...SECTIONS.map((s) => {
        const badge = s.badge?.(tab);
        return h(
          `button.desk-tab.as-subtab${tab.reqTab === s.id ? ".is-selected" : ""}`,
          {
            type: "button",
            role: "tab",
            "aria-selected": String(tab.reqTab === s.id),
            dataset: { section: s.id },
            onClick: () => {
              tab.reqTab = s.id;
              drawStrip();
              drawPanel();
              S.app.emit("layout");
            },
          },
          s.label,
          typeof badge === "number" && badge > 0
            ? h("span.tab-count", null, String(badge))
            : badge === true
              ? h("span.tab-dot", { "aria-label": "set" })
              : null,
        );
      }),
    );
  };
  const drawPanel = () => {
    const section = SECTIONS.find((s) => s.id === tab.reqTab) ?? SECTIONS[0];
    if (!section) return;
    shown = section.draw(S, tab);
    panel.replaceChildren(shown.el);
    panel.dataset.section = section.id;
  };
  drawStrip();
  drawPanel();

  return {
    el: h("section.as-req", null, strip, panel),
    /** Counts changed (a row added, auth chosen). */
    badges: drawStrip,
    /** The URL bar changed the query: the Params table follows. */
    syncUrl: () => shown?.syncUrl?.(),
    redraw: () => {
      drawStrip();
      drawPanel();
    },
  };
}
