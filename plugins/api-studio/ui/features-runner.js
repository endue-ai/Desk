// The runner in the studio: a Run tab for a collection or folder (from its page, its menu or the
// Runner panel), and the Runner panel listing what can be run.

import { button, h, icon } from "./dom.js";
import { newRequest } from "./model.js";
import { requestsOf } from "./runner.js";
import { runnerPane } from "./runner-pane.js";
import { addRail, panelHead } from "./view-side.js";

/**
 * @typedef {import("./studio.js").Studio} Studio
 * @typedef {import("./collection-fs.js").Collection} Collection
 * @typedef {import("./collection-fs.js").Node} Node
 */

/** @param {Studio} S */
export function installRunner(S) {
  S.panes.runner = runnerPane;
  /** Open the runner on a collection or one of its folders. @param {Collection} coll @param {string} path */
  S.runGroup = (coll, path) => {
    const node = path === coll.path ? undefined : S.collections.locate(coll, path)?.node;
    const name = node?.name ?? coll.name;
    S.app.open(
      newRequest({ id: `run-${path}`, name: `Run ${name}` }),
      { collection: coll.path, path },
      { saved: true, kind: "runner" },
    );
  };
}

/** @param {Studio} S */
function runnerPanel(S) {
  const list = h("div.as-side-list");
  const draw = () => {
    /** @type {Node[]} */
    const out = [];
    for (const coll of S.collections.list) {
      const total = requestsOf(coll.children).length;
      out.push(
        /** @type {any} */ (
          h(
            "div.as-run-pick",
            null,
            h("span.as-coll-icon", null, icon("collections", 14)),
            h("span.as-node-name", null, coll.name),
            h("span.as-env-count", null, String(total)),
            button({
              label: `Run ${coll.name}`,
              icon: "play",
              hideLabel: true,
              kind: "as-node-more as-run-go",
              onClick: () => S.runGroup(coll, coll.path),
            }),
          )
        ),
      );
      for (const n of coll.children)
        if (n.type === "folder")
          out.push(
            /** @type {any} */ (
              h(
                "div.as-run-pick.is-folder",
                null,
                h("span.as-node-icon", null, icon("folder", 14)),
                h("span.as-node-name", null, n.name),
                h("span.as-env-count", null, String(requestsOf(n.children).length)),
                button({
                  label: `Run ${n.name}`,
                  icon: "play",
                  hideLabel: true,
                  kind: "as-node-more as-run-go",
                  onClick: () => S.runGroup(coll, n.path),
                }),
              )
            ),
          );
    }
    list.replaceChildren(
      ...(out.length
        ? out
        : [
            h(
              "div.as-side-empty",
              null,
              icon("runner", 22),
              h("p", null, "Open a collection to run its requests in order."),
            ),
          ]),
    );
  };
  draw();
  return {
    el: h(
      "div.as-panel",
      null,
      panelHead("Runner"),
      h(
        "p.as-hint.as-side-note",
        null,
        "Run a collection or a folder: every request in order, as many times as you like, with data rows.",
      ),
      list,
    ),
    redraw: draw,
    topics: /** @type {import("./app.js").Topic[]} */ (["collections"]),
  };
}

addRail({ id: "runner", label: "Runner", icon: "runner", order: 25, draw: runnerPanel });
