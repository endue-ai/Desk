// The Collections panel: each open collection as a tree of folders and requests (method badges,
// the open request marked), filtered by a search. Click opens, right-click offers what can be
// done, drag moves a request or folder before another or into a folder.

import { button, h, icon, methodBadge } from "./dom.js";
import { ask, confirm, showMenu } from "./menu.js";
import { methodClass } from "./model.js";
import { addRail, panelHead, panelSearch } from "./view-side.js";

/**
 * @typedef {import("./studio.js").Studio} Studio
 * @typedef {import("./collection-fs.js").Collection} Collection
 * @typedef {import("./collection-fs.js").Node} Node
 */

/** Whether a node or anything under it matches a search. @param {Node} node @param {string} q */
function matches(node, q) {
  if (!q) return true;
  if (
    `${node.name} ${node.type === "request" ? `${node.method} ${node.req.url}` : ""}`
      .toLowerCase()
      .includes(q)
  )
    return true;
  return node.type === "folder" && node.children.some((c) => matches(c, q));
}

/** @param {Studio} S */
function collectionsPanel(S) {
  let query = "";
  const tree = h("div.as-side-list.as-tree", { role: "tree", "aria-label": "Collections" });
  const open = new Set(/** @type {string[]} */ (S.app.state.layout.expanded ?? []));
  const keep = () => S.app.layout({ expanded: [...open] });
  /** @type {{ coll: Collection, node: Node } | null} */
  let dragging = null;

  /** @param {Collection} coll @param {string} dir */
  const addMenu = (coll, dir) => [
    {
      label: "New request",
      icon: /** @type {const} */ ("plus"),
      run: () => S.collections.newRequest(coll, dir),
    },
    {
      label: "New folder…",
      icon: /** @type {const} */ ("folder"),
      run: async () => {
        const name = await ask("New folder", "Name", "", "Create");
        if (!name) return;
        const path = await S.collections.newFolder(coll, dir, name);
        open.add(path);
        open.add(dir);
        keep();
      },
    },
  ];

  /** @param {Collection} coll @param {Node} node */
  const nodeMenu = (coll, node) => [
    ...(node.type === "folder"
      ? [
          ...addMenu(coll, node.path),
          "-",
          {
            label: "Settings",
            icon: /** @type {const} */ ("settings"),
            run: () => S.collections.openGroup(coll, node.path),
          },
          {
            label: "Run folder",
            icon: /** @type {const} */ ("runner"),
            run: () => S.runGroup?.(coll, node.path),
          },
        ]
      : [
          { label: "Open", icon: /** @type {const} */ ("send"), run: () => S.openNode(coll, node) },
          {
            label: "Duplicate",
            icon: /** @type {const} */ ("copy"),
            run: () => S.collections.duplicate(coll, node),
          },
        ]),
    "-",
    {
      label: "Rename…",
      icon: /** @type {const} */ ("edit"),
      run: async () => {
        const name = await ask(`Rename ${node.type}`, "Name", node.name, "Rename");
        if (name && name !== node.name) await S.collections.rename(coll, node, name);
      },
    },
    {
      label: "Delete",
      icon: /** @type {const} */ ("trash"),
      danger: true,
      run: async () => {
        const what =
          node.type === "folder"
            ? `the folder “${node.name}” and everything in it`
            : `“${node.name}”`;
        if (await confirm("Delete", `Move ${what} to the trash?`, "Delete", true))
          await S.collections.remove(coll, node);
      },
    },
  ];

  /** @param {Collection} coll @param {Node} node @param {number} depth */
  const row = (coll, node, depth) => {
    const isOpen = open.has(node.path) || !!query;
    const activeTab = S.app.current();
    const active = activeTab?.ref?.path === node.path;
    const el = h(
      `div.as-node.desk-row${active ? ".is-selected" : ""}`,
      {
        role: "treeitem",
        tabindex: "0",
        draggable: "true",
        "aria-expanded": node.type === "folder" ? String(isOpen) : undefined,
        style: { "--depth": String(depth) },
        title: node.type === "request" ? `${node.method} ${node.req.url}` : node.name,
        onClick: () => {
          if (node.type === "folder") {
            if (open.has(node.path)) open.delete(node.path);
            else open.add(node.path);
            keep();
            draw();
          } else S.openNode(coll, node);
        },
        onDblclick: () =>
          node.type === "folder" ? S.collections.openGroup(coll, node.path) : undefined,
        onKeydown: (/** @type {KeyboardEvent} */ e) => {
          if (e.key === "Enter") el.click();
        },
        onContextmenu: (/** @type {MouseEvent} */ e) => {
          e.preventDefault();
          showMenu(nodeMenu(coll, node), { x: e.clientX, y: e.clientY }, { width: 200 });
        },
        onDragstart: (/** @type {DragEvent} */ e) => {
          dragging = { coll, node };
          e.dataTransfer?.setData("text/plain", node.name);
          el.classList.add("is-dragging");
        },
        onDragend: () => {
          dragging = null;
          el.classList.remove("is-dragging");
        },
        onDragover: (/** @type {DragEvent} */ e) => {
          if (!dragging || dragging.coll !== coll || dragging.node === node) return;
          e.preventDefault();
          const r = el.getBoundingClientRect();
          const y = (e.clientY - r.top) / r.height;
          const into = node.type === "folder" && y > 0.3 && y < 0.7;
          el.dataset.drop = into ? "into" : y < 0.5 ? "before" : "after";
        },
        onDragleave: () => delete el.dataset.drop,
        onDrop: async (/** @type {DragEvent} */ e) => {
          e.preventDefault();
          const where = el.dataset.drop;
          delete el.dataset.drop;
          if (!dragging || dragging.coll !== coll) return;
          const moving = dragging.node;
          dragging = null;
          if (where === "into" && node.type === "folder") {
            open.add(node.path);
            keep();
            await S.collections.move(coll, moving, node.path);
          } else {
            const dir = node.path.replace(/\/[^/]+$/, "");
            const parent = dir === coll.path ? undefined : S.collections.locate(coll, dir)?.node;
            /** @type {Node[]} */
            const siblings = parent?.type === "folder" ? parent.children : coll.children;
            const at = siblings.indexOf(node);
            const before = where === "before" ? node : siblings[at + 1];
            await S.collections.move(
              coll,
              moving,
              dir,
              before && before !== moving ? before : undefined,
            );
          }
        },
      },
      node.type === "folder"
        ? h("span.as-chev", null, icon(isOpen ? "chevronDown" : "chevronRight", 13))
        : h("span.as-chev"),
      node.type === "folder"
        ? h("span.as-node-icon", null, icon(isOpen ? "folderOpen" : "folder", 15))
        : methodBadge(node.method, methodClass(node.method)),
      h("span.as-node-name", null, node.name),
      button({
        label: "More",
        icon: "more",
        hideLabel: true,
        kind: "as-node-more",
        onClick: (e) => {
          e.stopPropagation();
          showMenu(nodeMenu(coll, node), /** @type {Element} */ (e.currentTarget), { width: 200 });
        },
      }),
    );
    /** @type {Node[]} */
    const out = [el];
    if (node.type === "folder" && isOpen)
      for (const child of node.children)
        if (matches(child, query)) out.push(.../** @type {any} */ (row(coll, child, depth + 1)));
    return out;
  };

  const draw = () => {
    const list = S.collections.list;
    if (!list.length) {
      tree.replaceChildren(
        h(
          "div.as-side-empty",
          null,
          icon("collections", 24),
          h("p", null, "Collections are folders of request files."),
          h("p.as-hint", null, "Keep them in a Git repository next to the code they test."),
          button({
            label: "New collection",
            icon: "plus",
            kind: "desk-btn-primary",
            onClick: () => S.newCollection(),
          }),
          button({
            label: "Open a folder…",
            icon: "folderOpen",
            onClick: () => S.openCollection(),
          }),
        ),
      );
      return;
    }
    /** @type {Node[]} */
    const rows = [];
    for (const coll of list) {
      const isOpen = !open.has(`closed:${coll.path}`);
      const active = S.app.current()?.kind === "group" && S.app.current()?.ref?.path === coll.path;
      rows.push(
        /** @type {any} */ (
          h(
            `div.as-coll${active ? ".is-selected" : ""}`,
            {
              role: "treeitem",
              tabindex: "0",
              "aria-expanded": String(isOpen),
              title: coll.path,
              onClick: () => {
                if (isOpen) open.add(`closed:${coll.path}`);
                else open.delete(`closed:${coll.path}`);
                keep();
                draw();
              },
              onDblclick: () => S.collections.openGroup(coll, coll.path),
              onContextmenu: (/** @type {MouseEvent} */ e) => {
                e.preventDefault();
                showMenu(
                  S.collectionMenu(coll, addMenu(coll, coll.path)),
                  { x: e.clientX, y: e.clientY },
                  { width: 220 },
                );
              },
              onDragover: (/** @type {DragEvent} */ e) => {
                if (dragging?.coll === coll) e.preventDefault();
              },
              onDrop: async (/** @type {DragEvent} */ e) => {
                e.preventDefault();
                if (dragging?.coll !== coll) return;
                const moving = dragging.node;
                dragging = null;
                await S.collections.move(coll, moving, coll.path);
              },
            },
            h("span.as-chev", null, icon(isOpen ? "chevronDown" : "chevronRight", 13)),
            h("span.as-coll-icon", null, icon("collections", 15)),
            h("span.as-coll-name", null, coll.name),
            coll.error ? h("span.as-coll-warn", { title: coll.error }, icon("alert", 14)) : null,
            button({
              label: "More",
              icon: "more",
              hideLabel: true,
              kind: "as-node-more",
              onClick: (e) => {
                e.stopPropagation();
                showMenu(
                  S.collectionMenu(coll, addMenu(coll, coll.path)),
                  /** @type {Element} */ (e.currentTarget),
                  { width: 220 },
                );
              },
            }),
          )
        ),
      );
      if (isOpen) {
        const kids = coll.children.filter((n) => matches(n, query));
        if (!kids.length && !query)
          rows.push(
            /** @type {any} */ (
              h(
                "div.as-tree-empty",
                null,
                "Empty. ",
                h(
                  "button.desk-btn.desk-btn-quiet.as-link",
                  { type: "button", onClick: () => S.collections.newRequest(coll, coll.path) },
                  "Add a request",
                ),
              )
            ),
          );
        for (const node of kids) rows.push(.../** @type {any[]} */ (row(coll, node, 1)));
      }
    }
    tree.replaceChildren(.../** @type {any[]} */ (rows));
  };
  draw();

  const el = h(
    "div.as-panel",
    null,
    panelHead(
      "Collections",
      button({
        label: "New collection",
        icon: "plus",
        hideLabel: true,
        onClick: () => S.newCollection(),
      }),
      button({
        label: "Open a collection folder",
        icon: "folderOpen",
        hideLabel: true,
        onClick: () => S.openCollection(),
      }),
      button({
        label: "More",
        icon: "more",
        hideLabel: true,
        onClick: (e) =>
          showMenu(S.panelMenu(), /** @type {Element} */ (e.currentTarget), { width: 220 }),
      }),
    ),
    panelSearch("Filter requests", (q) => {
      query = q;
      draw();
    }),
    tree,
  );
  return {
    el,
    redraw: draw,
    topics: /** @type {import("./app.js").Topic[]} */ (["collections", "tab", "tabs"]),
  };
}

addRail({
  id: "collections",
  label: "Collections",
  icon: "collections",
  order: 10,
  draw: collectionsPanel,
});
