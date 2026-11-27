// The keys, shown with ?: the studio's own single keys (the desk keeps every chord with Mod or
// Alt), those of the lists, and those of a container's page.

import { h } from "./dom.js";
import { SECTIONS } from "./view-shell.js";

/** @typedef {import("./studio.js").App} App */

const GROUPS = /** @type {Array<[string, Array<[string, string]>]>} */ ([
  [
    "Everywhere",
    [
      ["/", "Search the page"],
      ["A", "Ask AI"],
      ["?", "These keys"],
      ["Esc", "Back to the list"],
      ...SECTIONS.map((s, i) => /** @type {[string, string]} */ ([String(i + 1), s.title])),
    ],
  ],
  [
    "In a list",
    [
      ["↑ ↓ or J K", "Move"],
      ["Space", "Mark (Shift: a range)"],
      ["↵", "Open"],
      ["Esc", "Clear the marks"],
      ["Right-click", "Everything it can do"],
    ],
  ],
  ["On a container's page", [["[ ]", "The tab before or after"]]],
]);

/** @param {App} app */
export function openKeys(app) {
  app.overlay.dialog({
    title: "Keys",
    icon: "keyboard",
    body: GROUPS.map(([title, keys]) =>
      h(
        "section.keys-group",
        null,
        h("h3", null, title),
        h(
          "dl.keys-list",
          null,
          keys.flatMap(([k, what]) => [h("dt", null, h("kbd", null, k)), h("dd", null, what)]),
        ),
      ),
    ),
  });
}
