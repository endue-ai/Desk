// A plan node's marks (explain/marks.js) as badges that say in words why it is slow; the badge's
// colour only repeats what the words say. The tree and the table views draw them.

import { el } from "./dom.js";

/** @param {Document} doc @param {import("./explain/node.js").PlanNode} node */
export function marksView(doc, node) {
  if (!node.marks.length) return undefined;
  return el(
    doc,
    "span",
    { class: "plan-marks" },
    ...node.marks.map((m) =>
      el(
        doc,
        "span",
        { class: `desk-badge plan-mark mark-${m.level}`, "data-mark": m.kind },
        m.text,
      ),
    ),
  );
}
