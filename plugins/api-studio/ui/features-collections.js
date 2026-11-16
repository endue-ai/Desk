// Collections in the studio: Save writes a request to its file (or asks where, the first time),
// the home page and panel offer to make or open a collection, and the side panel's tree opens
// requests and folders. A seeded example collection can be made in one click.

import { join } from "./collection-fs.js";
import { createCollections } from "./collections.js";
import { h, icon, methodBadge } from "./dom.js";
import { ask, dialog } from "./menu.js";
import { clone, methodClass } from "./model.js";
import "./view-collections.js";

/**
 * @typedef {import("./studio.js").Studio} Studio
 * @typedef {import("./app.js").Tab} Tab
 * @typedef {import("./collection-fs.js").Collection} Collection
 * @typedef {import("./collection-fs.js").Node} Node
 */

/** Every place a request can be saved: each collection and its folders, indented. @param {Collection[]} list */
export function destinations(list) {
  /** @type {{ coll: Collection, dir: string, label: string, depth: number }[]} */
  const out = [];
  for (const coll of list) {
    out.push({ coll, dir: coll.path, label: coll.name, depth: 0 });
    const walk = (/** @type {Node[]} */ nodes, /** @type {number} */ depth) => {
      for (const n of nodes)
        if (n.type === "folder") {
          out.push({ coll, dir: n.path, label: n.name, depth });
          walk(n.children, depth + 1);
        }
    };
    walk(coll.children, 1);
  }
  return out;
}

/** @param {Studio} S */
export function installCollections(S) {
  const collections = createCollections(S);
  S.collections = collections;

  /** Ask where a new request goes, and its name. @param {Tab} tab */
  const saveAs = async (tab) => {
    if (!collections.list.length) {
      const made = await S.newCollection();
      if (!made) return false;
    }
    const places = destinations(collections.list);
    const current = S.app.current();
    let chosen = places.find((p) => p.coll.path === current?.ref?.collection) ?? places[0];
    const name = /** @type {HTMLInputElement} */ (
      h("input.desk-field.as-dialog-input", {
        type: "text",
        value: tab.req.name === "Untitled request" ? "" : tab.req.name,
        placeholder: "List users",
        "aria-label": "Name",
      })
    );
    const rows = places.map((p) =>
      h(
        `button.desk-row.as-dest${p === chosen ? ".is-selected" : ""}`,
        {
          type: "button",
          style: { "--depth": String(p.depth) },
          onClick: (/** @type {MouseEvent} */ e) => {
            chosen = p;
            for (const r of rows) r.classList.remove("is-selected");
            /** @type {HTMLElement} */ (e.currentTarget).classList.add("is-selected");
          },
        },
        icon(p.depth === 0 ? "collections" : "folder", 15),
        h("span", null, p.label),
      ),
    );
    const ok = await dialog({
      title: "Save request",
      className: "is-save",
      body: [
        h("label.as-dialog-label", null, "Name"),
        name,
        h("label.as-dialog-label", null, "Save in"),
        h("div.as-dest-list", null, ...rows),
      ],
      actions: [
        { label: "Cancel", value: () => false },
        { label: "Save", kind: "desk-btn-primary", value: () => true },
      ],
    });
    if (!ok || !chosen) return false;
    tab.req.name = name.value.trim() || tab.req.name || "Untitled request";
    if (!(await collections.saveAs(tab, chosen.coll, chosen.dir))) return false;
    S.app.toast(`Saved to ${chosen.label}`, "ok");
    return true;
  };

  S.save = async (/** @type {Tab} */ tab) => {
    try {
      if (tab.kind === "group") return await collections.saveGroup(tab);
      if (tab.ref && collections.byPath(tab.ref.collection)) {
        const ok = await collections.saveRequest(tab);
        if (ok) S.app.toast("Saved", "ok");
        return ok;
      }
      return await saveAs(tab);
    } catch (error) {
      S.app.toast(
        `Could not save: ${String(/** @type {any} */ (error)?.message ?? error)}`,
        "error",
      );
      return false;
    }
  };

  /** @param {Collection} coll @param {Node} node */
  S.openNode = (coll, node) => {
    if (node.type === "folder") collections.openGroup(coll, node.path);
    else S.app.open(clone(node.req), { collection: coll.path, path: node.path });
  };

  /** Ask for a folder, then a name, and make a collection there. */
  S.newCollection = async () => {
    const name = await ask("New collection", "Name", "", "Next");
    if (!name) return undefined;
    const picked = await S.ctx.bridge
      .call("dialog.open", { kind: "folders", title: `Where to keep “${name}”` })
      .catch(() => ({ cancelled: true }));
    const parent = picked?.cancelled ? undefined : picked?.paths?.[0];
    if (!parent) return undefined;
    try {
      const coll = await collections.create(parent, name);
      if (coll) collections.openGroup(coll, coll.path);
      S.app.layout({ rail: "collections", side: true });
      return coll;
    } catch (error) {
      S.app.toast(
        `Could not make the collection: ${String(/** @type {any} */ (error)?.message ?? error)}`,
        "error",
      );
      return undefined;
    }
  };

  /** Ask for a collection folder and open it. */
  S.openCollection = async () => {
    const picked = await S.ctx.bridge
      .call("dialog.open", { kind: "folders", title: "Open a collection folder" })
      .catch(() => ({ cancelled: true }));
    const path = picked?.cancelled ? undefined : picked?.paths?.[0];
    if (!path) return;
    const coll = await collections.open(path);
    S.app.layout({ rail: "collections", side: true });
    if (coll?.error) S.app.toast(coll.error.split("\n")[0] ?? "", "error");
  };

  /** @param {Collection} coll @param {any[]} adds */
  S.collectionMenu = (coll, adds) => [
    ...adds,
    "-",
    { label: "Settings", icon: "settings", run: () => collections.openGroup(coll, coll.path) },
    { label: "Run collection", icon: "runner", run: () => S.runGroup?.(coll, coll.path) },
    { label: "Reload from disk", icon: "refresh", run: () => collections.reload(coll.path) },
    "-",
    { label: "Close collection", icon: "close", run: () => collections.close(coll.path) },
  ];
  S.panelMenu = () => [
    { label: "New collection…", icon: "plus", run: () => S.newCollection() },
    { label: "Open a collection folder…", icon: "folderOpen", run: () => S.openCollection() },
    ...(S.importMenu?.() ?? []),
  ];

  /** Save a history entry into a collection. @param {import("./app.js").HistoryEntry} entry */
  S.saveHistory = (entry) => {
    S.openHistory(entry);
    const tab = S.app.current();
    if (tab) void saveAs(tab);
  };

  const base = S.homeActions;
  S.homeActions = () => [
    ...base(),
    {
      icon: "collections",
      label: "New collection",
      text: "A folder of requests you can keep in Git",
      run: () => S.newCollection(),
    },
    {
      icon: "folderOpen",
      label: "Open a collection",
      text: "Pick a folder that holds one",
      run: () => S.openCollection(),
    },
  ];

  /** A request row for lists (the run report, the overview). @param {Node} n */
  S.nodeLabel = (n) =>
    h(
      "span.as-node-label",
      null,
      n.type === "request" ? methodBadge(n.method, methodClass(n.method)) : icon("folder", 14),
      n.name,
    );
  S.joinPath = join;
  return collections;
}
