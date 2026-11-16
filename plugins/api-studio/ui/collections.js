// The collections the person keeps open: read from their folders, kept current when their files
// change, and changed through here (save, new, rename, duplicate, move, delete). A request's tab
// remembers which file it came from; its folders and collection give it auth, headers and
// variables, nearest first.

import {
  COLLECTION_FILE,
  createFiles,
  freeName,
  groupFile,
  join,
  readCollection,
  text,
} from "./collection-fs.js";
import { editOps } from "./collections-edit.js";
import { scope } from "./vars.js";

/**
 * @typedef {import("./collection-fs.js").Collection} Collection
 * @typedef {import("./collection-fs.js").Node} Node
 * @typedef {import("./collection-fs.js").FolderNode} FolderNode
 * @typedef {import("./collection-fs.js").Group} Group
 * @typedef {import("./app.js").Tab} Tab
 * @typedef {import("./studio.js").Studio} Studio
 */

/** @param {Studio} S */
export function createCollections(S) {
  const files = createFiles(S.ctx.bridge);
  /** @type {Collection[]} */
  let list = [];
  /** @type {Map<string, string>} watchId → collection path */
  const watches = new Map();
  let quietUntil = 0;
  /** @type {Map<string, ReturnType<typeof setTimeout>>} */
  const pendingReload = new Map();

  const emit = () => S.app.emit("collections");
  const persist = () =>
    S.ctx.bridge
      .call("store.set", { key: "collections", value: list.map((c) => c.path) })
      .catch(() => {});

  /** @param {string} path */
  const byPath = (path) => list.find((c) => c.path === path);

  /** Read one collection again and put it where it was. @param {string} path */
  const reload = async (path) => {
    try {
      const fresh = await readCollection(files, path);
      const at = list.findIndex((c) => c.path === path);
      if (at >= 0) list[at] = fresh;
      else list.push(fresh);
    } catch (error) {
      const at = list.findIndex((c) => c.path === path);
      /** @type {Collection} */
      const broken = {
        path,
        name: path.split("/").pop() ?? path,
        meta: {
          name: path,
          auth: { type: "none" },
          headers: [],
          vars: [],
          scripts: { pre: "", post: "" },
          docs: "",
        },
        children: [],
        envs: [],
        error: `Could not read the folder: ${String(/** @type {any} */ (error)?.message ?? error)}`,
      };
      if (at >= 0) list[at] = broken;
      else list.push(broken);
    }
    emit();
  };

  /** Writes from here are not changes from outside: hold the watcher's reload a moment. */
  const wrote = () => {
    quietUntil = Date.now() + 1200;
  };

  S.ctx.bridge.onEvent((/** @type {any} */ event) => {
    if (event.event !== "fs.changed") return;
    const path = watches.get(event.data.watchId);
    if (!path || Date.now() < quietUntil) return;
    clearTimeout(pendingReload.get(path));
    pendingReload.set(
      path,
      setTimeout(() => void reload(path), 300),
    );
  });

  /** @param {string} path */
  const watch = async (path) => {
    try {
      const { watchId } = await files.watch(path, path);
      if (watchId) watches.set(watchId, path);
    } catch {
      /* no watching: changes from outside show after a refresh */
    }
  };

  /** Find a node by its path, with the folders above it (outermost first). @param {Collection} coll @param {string} path */
  const locate = (coll, path) => {
    /** @param {Node[]} nodes @param {FolderNode[]} chain @returns {{ node: Node, chain: FolderNode[] } | undefined} */
    const walk = (nodes, chain) => {
      for (const node of nodes) {
        if (node.path === path) return { node, chain };
        if (node.type === "folder") {
          const found = walk(node.children, [...chain, node]);
          if (found) return found;
        }
      }
      return undefined;
    };
    return walk(coll.children, []);
  };

  /** The groups above a tab, nearest first: its folders, then its collection. @param {Tab} tab */
  const parents = (tab) => {
    const coll = tab.ref && byPath(tab.ref.collection);
    if (!coll || !tab.ref) return [];
    if (tab.kind === "group") {
      if (tab.ref.path === coll.path) return [];
      const found = locate(coll, tab.ref.path);
      return [...(found?.chain ?? []).map((f) => f.meta).reverse(), coll.meta];
    }
    const found = locate(coll, tab.ref.path);
    return [...(found?.chain ?? []).map((f) => f.meta).reverse(), coll.meta];
  };

  /** Siblings' next seq in a folder. @param {Collection} coll @param {string} dir */
  const nextSeq = (coll, dir) => {
    const found = dir === coll.path ? undefined : locate(coll, dir);
    const siblings = found?.node.type === "folder" ? found.node.children : coll.children;
    return siblings.reduce((m, n) => Math.max(m, n.seq < 1e6 ? n.seq : 0), 0) + 1;
  };

  /** Point open tabs at a new path after a move or rename. @param {string} from @param {string} to */
  const repoint = (from, to) => {
    for (const tab of S.app.state.tabs) {
      if (!tab.ref) continue;
      if (tab.ref.path === from) tab.ref = { ...tab.ref, path: to };
      else if (tab.ref.path.startsWith(`${from}/`))
        tab.ref = { ...tab.ref, path: to + tab.ref.path.slice(from.length) };
    }
    S.app.emit("tabs");
  };

  const api = {
    get list() {
      return list;
    },
    files,
    byPath,
    locate,
    parents,
    reload,
    /** Open the collections that were open last time. */
    async start() {
      try {
        const kept = await S.ctx.bridge.call("store.get", { key: "collections" });
        const paths = Array.isArray(kept?.value) ? kept.value.map(String) : [];
        await Promise.all(paths.map((p) => reload(p)));
        for (const p of paths) void watch(p);
      } catch {
        /* nothing kept */
      }
    },
    /** Open a collection folder (or reread it when it is open). @param {string} path */
    async open(path) {
      const clean = path.replace(/\/+$/, "");
      await reload(clean);
      if (!watches.size || ![...watches.values()].includes(clean)) void watch(clean);
      await persist();
      return byPath(clean);
    },
    /** Stop showing a collection; its files stay. @param {string} path */
    async close(path) {
      list = list.filter((c) => c.path !== path);
      for (const [id, p] of watches) if (p === path) watches.delete(id);
      emit();
      await persist();
    },
    /** Make a new collection folder inside `parent`. @param {string} parent @param {string} name */
    async create(parent, name) {
      const root = await freeName(files, parent, name, "", parent);
      await files.mkdir(root, root);
      wrote();
      await files.write(
        join(root, COLLECTION_FILE),
        text(
          groupFile(
            {
              name,
              auth: { type: "none" },
              headers: [],
              vars: [],
              scripts: { pre: "", post: "" },
              docs: "",
            },
            true,
          ),
        ),
        root,
      );
      return api.open(root);
    },
    ...editOps({ S, files, byPath, locate, reload, wrote, nextSeq, repoint, emit }),
  };

  // What a request inherits: auth and headers from its parents, and their variables as scopes.
  S.parentAuth = (/** @type {Tab} */ tab) => parents(tab).map((g) => g.auth);
  S.parentNames = (/** @type {Tab} */ tab) => parents(tab).map((g) => g.name);
  S.parentHeaders = (/** @type {Tab} */ tab) =>
    parents(tab)
      .reverse()
      .flatMap((g) => g.headers);
  S.scopeProviders.push((/** @type {Tab} */ tab) => {
    const groups = parents(tab);
    const coll = groups.pop();
    return [
      ...groups.map((g) => scope("folder", `Folder ${g.name}`, g.vars)),
      ...S.envScopes(tab),
      ...(coll ? [scope("collection", "Collection", coll.vars)] : []),
      ...S.globalScopes(),
    ];
  });
  return api;
}

/** @typedef {ReturnType<typeof createCollections>} Collections */
