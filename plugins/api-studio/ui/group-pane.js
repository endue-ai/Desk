// A folder's or collection's own page: its name and where it lives, then Overview (what is in it
// and its notes), and the sections it shares with requests (Headers, Auth, and those later
// features add). Everything in it applies to every request below it.

import { button, h, icon, keys, methodBadge } from "./dom.js";
import { methodClass } from "./model.js";
import { docsEditor } from "./section-docs.js";
import { addSections, requestPane } from "./view-request.js";

/**
 * @typedef {import("./studio.js").Studio} Studio
 * @typedef {import("./app.js").Tab} Tab
 * @typedef {import("./collection-fs.js").Node} Node
 */

/** "1 request", "3 requests". @param {number} n @param {string} word */
export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Count the requests and folders under nodes. @param {Node[]} nodes */
export function countNodes(nodes) {
  let requests = 0;
  let folders = 0;
  /** @type {Record<string, number>} */
  const methods = {};
  const walk = (/** @type {Node[]} */ list) => {
    for (const n of list) {
      if (n.type === "request") {
        requests++;
        methods[n.method] = (methods[n.method] ?? 0) + 1;
      } else {
        folders++;
        walk(n.children);
      }
    }
  };
  walk(nodes);
  return { requests, folders, methods };
}

/** The nodes directly under a group tab's folder or collection. @param {Studio} S @param {Tab} tab */
function childrenOf(S, tab) {
  const coll = tab.ref && S.collections.byPath(tab.ref.collection);
  if (!coll || !tab.ref) return { coll: undefined, nodes: [] };
  if (tab.ref.path === coll.path) return { coll, nodes: coll.children };
  const node = S.collections.locate(coll, tab.ref.path)?.node;
  return { coll, nodes: node?.type === "folder" ? node.children : [] };
}

/** @param {Studio} S @param {Tab} tab */
function overview(S, tab) {
  const { coll, nodes } = childrenOf(S, tab);
  const counts = countNodes(nodes);
  const isRoot = coll && tab.ref?.path === coll.path;
  const docs = docsEditor(S, tab, { minLines: 12 });
  const stat = (/** @type {string} */ n, /** @type {string} */ label) =>
    h("div.as-stat-card", null, h("strong", null, n), h("span", null, label));
  const list = h(
    "div.as-over-list",
    null,
    ...nodes.slice(0, 40).map((n) =>
      h(
        "button.desk-row.as-over-row",
        {
          type: "button",
          onClick: () => (coll ? S.openNode(coll, n) : undefined),
        },
        n.type === "request" ? methodBadge(n.method, methodClass(n.method)) : icon("folder", 15),
        h("span.as-over-name", null, n.name),
        n.type === "folder"
          ? h("span.as-over-meta", null, plural(countNodes(n.children).requests, "request"))
          : null,
      ),
    ),
  );
  return {
    el: h(
      "div.as-section.as-overview",
      null,
      h(
        "div.as-stats",
        null,
        stat(String(counts.requests), counts.requests === 1 ? "request" : "requests"),
        stat(String(counts.folders), counts.folders === 1 ? "folder" : "folders"),
        ...(isRoot && coll
          ? [
              stat(
                String(coll.envs.length),
                coll.envs.length === 1 ? "environment" : "environments",
              ),
            ]
          : []),
        h(
          "div.as-methods",
          null,
          ...Object.entries(counts.methods).map(([m, n]) =>
            h("span.as-method-count", null, methodBadge(m, methodClass(m)), String(n)),
          ),
        ),
      ),
      h(
        "div.as-over-cols",
        null,
        h("div.as-over-col", null, h("h3", null, "Notes"), docs),
        h(
          "div.as-over-col",
          null,
          h("h3", null, "Inside"),
          nodes.length
            ? list
            : h("p.as-hint", null, "Nothing yet. Add a request or a folder from the side panel."),
        ),
      ),
    ),
  };
}

addSections([{ id: "overview", label: "Overview", group: "only", draw: overview }]);

/** @param {Studio} S @param {Tab} tab */
export function groupPane(S, tab) {
  const coll = tab.ref && S.collections.byPath(tab.ref.collection);
  const isRoot = coll && tab.ref?.path === coll.path;
  const name = /** @type {HTMLInputElement} */ (
    h("input.desk-field.as-group-name", { type: "text", value: tab.req.name, "aria-label": "Name" })
  );
  name.addEventListener("input", () => {
    tab.req.name = name.value;
    S.app.emit("req", { field: "name" });
  });
  const head = h(
    "div.as-group-head",
    null,
    h("span.as-group-icon", null, icon(isRoot ? "collections" : "folder", 20)),
    h(
      "div.as-group-title",
      null,
      name,
      h("span.as-group-path", { title: tab.ref?.path ?? "" }, tab.ref?.path ?? ""),
    ),
    h("span.as-grow"),
    isRoot && coll
      ? button({
          label: "Run collection",
          icon: "runner",
          onClick: () => S.runGroup?.(coll, coll.path),
        })
      : coll && tab.ref
        ? button({
            label: "Run folder",
            icon: "runner",
            onClick: () => (tab.ref ? S.runGroup?.(coll, tab.ref.path) : undefined),
          })
        : null,
    button({
      label: "Save",
      icon: "download",
      kind: "desk-btn-primary",
      title: `Save (${keys("Mod+S")})`,
      onClick: () => S.save(tab),
    }),
  );
  const pane = requestPane(S, tab);
  pane.el.classList.add("as-group-body");
  return {
    el: h(
      "div.as-group",
      null,
      head,
      h(
        "p.as-group-note",
        null,
        icon("info", 14),
        isRoot
          ? "Auth, headers and variables set here apply to every request in the collection."
          : "Auth, headers and variables set here apply to every request in this folder.",
      ),
      pane.el,
    ),
    pane,
  };
}
