// The edits a collection takes, each one file operation (or a few) on its folder: save a
// request in place or somewhere new, add requests and folders, rename, duplicate, move (with the
// order written back as seq numbers), delete, and the settings of a folder or collection. Before a
// request's or group's file is written, S.beforeWrite may change the tab or stop the save
// (literal-secrets.js).

import {
  COLLECTION_FILE,
  FOLDER_FILE,
  freeName,
  groupFile,
  join,
  parentOf,
  REQUEST_EXT,
  requestFile,
  slug,
  text,
} from "./collection-fs.js";
import { clone, newRequest, normalize, uid } from "./model.js";

/**
 * @typedef {import("./collection-fs.js").Collection} Collection
 * @typedef {import("./collection-fs.js").Node} Node
 * @typedef {import("./collection-fs.js").FolderNode} FolderNode
 * @typedef {import("./collection-fs.js").Group} Group
 * @typedef {import("./app.js").Tab} Tab
 * @typedef {{ S: import("./studio.js").Studio, files: import("./collection-fs.js").Files,
 *   byPath(path: string): Collection | undefined,
 *   locate(coll: Collection, path: string): { node: Node, chain: FolderNode[] } | undefined,
 *   reload(path: string): Promise<void>, wrote(): void, nextSeq(coll: Collection, dir: string): number,
 *   repoint(from: string, to: string): void, emit(): void }} EditContext
 */

/** @param {EditContext} c */
export function editOps(c) {
  const { S, files, byPath, locate, reload, wrote, nextSeq, repoint, emit } = c;
  const ops = {
    /** Write a request tab to its file, or ask where when it has none. @param {Tab} tab */
    async saveRequest(tab) {
      if (!tab.ref) return false;
      const before = byPath(tab.ref.collection);
      if (!before) return false;
      if (S.beforeWrite && !(await S.beforeWrite(tab, before, "inherit"))) return false;
      // beforeWrite may have written an environment, which rereads the collection.
      const coll = byPath(before.path) ?? before;
      wrote();
      await files.write(tab.ref.path, text(requestFile(tab.req)), coll.path);
      tab.saved = JSON.stringify(tab.req);
      const found = locate(coll, tab.ref.path);
      if (found?.node.type === "request") {
        found.node.req = clone(tab.req);
        found.node.name = tab.req.name;
        found.node.method = tab.req.method;
      } else await reload(coll.path);
      emit();
      S.app.emit("req", { field: "saved" });
      return true;
    },
    /** Save a tab as a new request in a folder of a collection. @param {Tab} tab @param {Collection} chosen @param {string} dir */
    async saveAs(tab, chosen, dir) {
      if (S.beforeWrite && !(await S.beforeWrite(tab, chosen, "inherit"))) return false;
      const coll = byPath(chosen.path) ?? chosen;
      const path = await freeName(files, dir, tab.req.name, REQUEST_EXT, coll.path);
      tab.req.seq = nextSeq(coll, dir);
      tab.ref = { collection: coll.path, path };
      wrote();
      await files.write(path, text(requestFile(tab.req)), coll.path);
      tab.saved = JSON.stringify(tab.req);
      await reload(coll.path);
      S.app.emit("tabs");
      return true;
    },
    /** A new request in a folder, opened in a tab. @param {Collection} coll @param {string} dir */
    async newRequest(coll, dir, over = {}) {
      const req = newRequest({ name: "New request", ...over, seq: nextSeq(coll, dir) });
      const path = await freeName(files, dir, req.name, REQUEST_EXT, coll.path);
      wrote();
      await files.write(path, text(requestFile(req)), coll.path);
      await reload(coll.path);
      S.app.open(req, { collection: coll.path, path });
    },
    /** A new folder. @param {Collection} coll @param {string} dir @param {string} name */
    async newFolder(coll, dir, name) {
      const path = await freeName(files, dir, name, "", coll.path);
      wrote();
      await files.mkdir(path, coll.path);
      await files.write(
        join(path, FOLDER_FILE),
        text(
          groupFile(
            {
              name,
              auth: { type: "inherit" },
              headers: [],
              vars: [],
              scripts: { pre: "", post: "" },
              docs: "",
              seq: nextSeq(coll, dir),
            },
            false,
          ),
        ),
        coll.path,
      );
      await reload(coll.path);
      return path;
    },
    /** Rename a request or folder: its name and its file. @param {Collection} coll @param {Node} node @param {string} name */
    async rename(coll, node, name) {
      wrote();
      if (node.type === "request") {
        const req = { ...node.req, name };
        const dir = parentOf(node.path);
        const to =
          slug(name) + REQUEST_EXT === node.path.split("/").pop()
            ? node.path
            : await freeName(files, dir, name, REQUEST_EXT, coll.path);
        await files.write(node.path, text(requestFile(req)), coll.path);
        if (to !== node.path) await files.rename(node.path, to, coll.path);
        for (const tab of S.app.state.tabs)
          if (tab.ref?.path === node.path) {
            tab.req.name = name;
            if (tab.saved) tab.saved = JSON.stringify({ ...JSON.parse(tab.saved), name });
          }
        repoint(node.path, to);
      } else {
        const meta = { ...node.meta, name };
        await files.write(join(node.path, FOLDER_FILE), text(groupFile(meta, false)), coll.path);
        const to = await freeName(files, parentOf(node.path), name, "", coll.path);
        if (slug(name) !== node.path.split("/").pop()) {
          await files.rename(node.path, to, coll.path);
          repoint(node.path, to);
        }
      }
      await reload(coll.path);
    },
    /** A copy of a request beside it. @param {Collection} coll @param {Node} node */
    async duplicate(coll, node) {
      if (node.type !== "request") return;
      const req = {
        ...clone(node.req),
        id: uid("r"),
        name: `${node.req.name} copy`,
        seq: node.seq + 0.5,
      };
      const path = await freeName(files, parentOf(node.path), req.name, REQUEST_EXT, coll.path);
      wrote();
      await files.write(path, text(requestFile(req)), coll.path);
      await ops.renumber(coll, parentOf(node.path), true);
    },
    /** Move a request or folder to the trash, and close its tabs. @param {Collection} coll @param {Node} node */
    async remove(coll, node) {
      wrote();
      await files.trash(node.path, coll.path);
      for (const tab of [...S.app.state.tabs])
        if (tab.ref && (tab.ref.path === node.path || tab.ref.path.startsWith(`${node.path}/`)))
          S.app.close(tab.id);
      await reload(coll.path);
    },
    /**
     * Move a node into a folder (or the collection's top), before another node there or last.
     * @param {Collection} coll @param {Node} node @param {string} dir @param {Node} [before]
     */
    async move(coll, node, dir, before) {
      if (node.type === "folder" && (dir === node.path || dir.startsWith(`${node.path}/`))) return;
      wrote();
      let path = node.path;
      if (parentOf(node.path) !== dir) {
        const ext = node.type === "request" ? REQUEST_EXT : "";
        path = await freeName(files, dir, node.name, ext, coll.path);
        await files.rename(node.path, path, coll.path);
        repoint(node.path, path);
      }
      await reload(coll.path);
      const fresh = byPath(coll.path);
      if (!fresh) return;
      const found = dir === fresh.path ? undefined : locate(fresh, dir);
      const siblings = (
        found?.node.type === "folder" ? found.node.children : fresh.children
      ).filter((n) => n.path !== path);
      const moved = locate(fresh, path)?.node;
      if (!moved) return;
      const at = before ? siblings.findIndex((n) => n.path === before.path) : -1;
      siblings.splice(at >= 0 ? at : siblings.length, 0, moved);
      await ops.writeOrder(fresh, siblings);
      await reload(coll.path);
    },
    /** Give siblings seq 1, 2, 3… in their order and write the ones that changed. @param {Collection} coll @param {Node[]} siblings */
    async writeOrder(coll, siblings) {
      wrote();
      let n = 1;
      for (const node of siblings) {
        const seq = n++;
        if (node.seq === seq) continue;
        node.seq = seq;
        if (node.type === "request") {
          node.req.seq = seq;
          await files.write(node.path, text(requestFile(node.req)), coll.path);
          for (const tab of S.app.state.tabs)
            if (tab.ref?.path === node.path) {
              tab.req.seq = seq;
              if (tab.saved) tab.saved = JSON.stringify({ ...JSON.parse(tab.saved), seq });
            }
        } else
          await files.write(
            join(node.path, FOLDER_FILE),
            text(groupFile({ ...node.meta, seq }, false)),
            coll.path,
          );
      }
    },
    /** Reread a folder and number its children again. @param {Collection} coll @param {string} dir @param {boolean} [read] */
    async renumber(coll, dir, read = false) {
      if (read) await reload(coll.path);
      const fresh = byPath(coll.path);
      if (!fresh) return;
      const found = dir === fresh.path ? undefined : locate(fresh, dir);
      await ops.writeOrder(
        fresh,
        found?.node.type === "folder" ? found.node.children : fresh.children,
      );
      await reload(coll.path);
    },
    /** Write a folder's or collection's settings from its tab. @param {Tab} tab */
    async saveGroup(tab) {
      const before = tab.ref && byPath(tab.ref.collection);
      if (!before || !tab.ref) return false;
      const root = tab.ref.path === before.path;
      if (S.beforeWrite && !(await S.beforeWrite(tab, before, root ? "none" : "inherit")))
        return false;
      const coll = byPath(before.path) ?? before;
      const found = root ? undefined : locate(coll, tab.ref.path)?.node;
      const old = root ? coll.meta : found?.type === "folder" ? found.meta : undefined;
      /** @type {Group} */
      const group = {
        name: tab.req.name,
        auth: tab.req.auth,
        headers: tab.req.headers,
        vars: tab.req.vars.pre,
        scripts: tab.req.scripts,
        docs: tab.req.docs,
        ...(old?.seq !== undefined ? { seq: old.seq } : {}),
      };
      wrote();
      await files.write(
        join(tab.ref.path, root ? COLLECTION_FILE : FOLDER_FILE),
        text(groupFile(group, root)),
        coll.path,
      );
      tab.saved = JSON.stringify(tab.req);
      await reload(coll.path);
      S.app.emit("req", { field: "saved" });
      return true;
    },
    /** Open a folder's or collection's settings in a tab. @param {Collection} coll @param {string} path */
    openGroup(coll, path) {
      const root = path === coll.path;
      const node = root ? undefined : locate(coll, path)?.node;
      const meta = root ? coll.meta : node?.type === "folder" ? node.meta : undefined;
      if (!meta) return;
      const req = normalize({
        id: `g-${path}`,
        name: meta.name,
        auth: meta.auth,
        headers: meta.headers,
        vars: { pre: meta.vars, post: [] },
        scripts: meta.scripts,
        docs: meta.docs,
      });
      const tab = S.app.open(req, { collection: coll.path, path }, { saved: true, kind: "group" });
      return tab;
    },
  };
  return ops;
}
