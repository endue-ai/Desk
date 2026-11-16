// Which collections' scripts may run. A collection opened from a folder can come from anyone (a
// clone, a download), and its scripts read every variable, secrets included, and can change where
// a request goes. So a script that came from the collection's files runs only once the person has
// allowed it: the studio keeps the SHA-256 of each script they allowed, per collection, in the
// desk's store, and asks again when a script arrives or changes on disk (a pull, a download).
// What the person writes in the studio is theirs: an edited script runs, and saving one allows it.

import { h } from "./dom.js";
import { hashKey } from "./environments.js";
import { dialog } from "./menu.js";
import { sha256 } from "./sha256.js";

/**
 * @typedef {import("./studio.js").Studio} Studio
 * @typedef {import("./app.js").Tab} Tab
 * @typedef {import("./collection-fs.js").Collection} Collection
 * @typedef {import("./collection-fs.js").Node} Node
 * @typedef {{ pre: string, post: string, tests: string }} Scripts
 */

/** The most hashes kept for one collection (the store keeps 64 KiB a key). */
const KEEP = 800;

/** A request's or group's scripts. @param {any} r @returns {Scripts} */
const scriptsOf = (r) => ({
  pre: String(r?.scripts?.pre ?? ""),
  post: String(r?.scripts?.post ?? ""),
  tests: String(r?.tests ?? ""),
});

/** Every script a collection's files hold. @param {Collection} coll @returns {string[]} */
export function scriptsIn(coll) {
  /** @type {string[]} */
  const out = [];
  const add = (/** @type {Scripts} */ s) => out.push(s.pre, s.post, s.tests);
  add(scriptsOf(coll.meta));
  const walk = (/** @type {Node[]} */ nodes) => {
    for (const n of nodes) {
      if (n.type === "folder") {
        add(scriptsOf(n.meta));
        walk(n.children);
      } else add(scriptsOf(n.req));
    }
  };
  walk(coll.children);
  return out.filter((t) => t.trim());
}

/** @param {Studio} S */
export function installTrust(S) {
  /** @type {Map<string, string[]>} collection path → hashes allowed, oldest first */
  const allowed = new Map();
  /** Collections the person said no to in this session. @type {Set<string>} */
  const declined = new Set();
  /** @type {Map<string, Promise<boolean>>} */
  const asking = new Map();
  const key = (/** @type {string} */ path) => `trust.${hashKey(path)}`;

  /** @param {string} path */
  const load = async (path) => {
    if (!allowed.has(path)) {
      let kept;
      try {
        kept = (await S.ctx.bridge.call("store.get", { key: key(path) }))?.value;
      } catch {
        kept = undefined;
      }
      allowed.set(path, kept?.path === path && Array.isArray(kept.hashes) ? kept.hashes : []);
    }
    return /** @type {string[]} */ (allowed.get(path));
  };
  /** @param {string} path @param {string[]} texts */
  const allow = async (path, texts) => {
    const fresh = new Set(texts.filter((t) => t.trim()).map(sha256));
    const kept = [...(await load(path)).filter((x) => !fresh.has(x)), ...fresh].slice(-KEEP);
    allowed.set(path, kept);
    declined.delete(path);
    await S.ctx.bridge
      .call("store.set", { key: key(path), value: { path, hashes: kept } })
      .catch(() => {});
  };

  /**
   * The scripts a send of `tab` runs that came from files: its folders' and collection's, and its
   * own wherever the tab still holds what the file holds (an edit in the studio is the person's).
   * @param {Tab} tab @param {Collection} coll
   */
  const fromFiles = (tab, coll) => {
    const texts = (S.collections.parents(tab) ?? []).flatMap((/** @type {any} */ g) => [
      String(g.scripts?.pre ?? ""),
      String(g.scripts?.post ?? ""),
    ]);
    const node = tab.ref ? S.collections.locate(coll, tab.ref.path)?.node : undefined;
    const own = scriptsOf(tab.req);
    const disk = node?.type === "request" ? scriptsOf(node.req) : undefined;
    for (const k of /** @type {const} */ (["pre", "post", "tests"]))
      if (!disk || disk[k] === own[k]) texts.push(own[k]);
    return texts.filter((t) => t.trim());
  };

  /** @param {Collection} coll @param {boolean} changed */
  const ask = (coll, changed) =>
    dialog({
      title: "Run this collection's scripts?",
      className: "is-trust",
      body: [
        h(
          "p.as-dialog-text",
          null,
          changed
            ? `The scripts of “${coll.name}” changed on disk since you allowed them.`
            : `“${coll.name}” has scripts that run before and after its requests.`,
        ),
        h("p.as-dialog-text", null, h("code", null, coll.path)),
        h(
          "p.as-dialog-text",
          null,
          "Scripts read every variable, secrets included, and can change where a request goes. Run them only if you trust where this collection came from.",
        ),
      ],
      actions: [
        { label: "Don't run", value: () => false },
        { label: "Run scripts", kind: "desk-btn-primary", value: () => true },
      ],
    }).then((yes) => yes === true);

  S.trust = {
    /** Whether the scripts a send of `tab` would run may run; asks once when they are new. @param {Tab} tab */
    async allows(tab) {
      const coll = tab.ref ? S.collections.byPath(tab.ref.collection) : undefined;
      if (!coll) return true;
      const texts = fromFiles(tab, coll);
      const hashes = await load(coll.path);
      if (texts.every((t) => hashes.includes(sha256(t)))) return true;
      if (declined.has(coll.path)) return false;
      const pending = asking.get(coll.path);
      if (pending) return pending;
      const answer = ask(coll, hashes.length > 0).then(async (yes) => {
        if (yes) await allow(coll.path, [...scriptsIn(coll), ...texts]);
        else declined.add(coll.path);
        return yes;
      });
      asking.set(coll.path, answer);
      try {
        return await answer;
      } finally {
        asking.delete(coll.path);
      }
    },
    /** Whether every script in a collection's files is allowed. @param {Collection} coll */
    async allowed(coll) {
      const hashes = await load(coll.path);
      return scriptsIn(coll).every((t) => hashes.includes(sha256(t)));
    },
    /** Allow every script a collection holds now. @param {Collection} coll */
    allowAll: (coll) => allow(coll.path, scriptsIn(coll)),
    /** Allow scripts the person wrote. @param {string} path @param {string[]} texts */
    allow,
    /** Stop running a collection's scripts until the person allows them again. @param {Collection} coll */
    async revoke(coll) {
      allowed.set(coll.path, []);
      declined.add(coll.path);
      await S.ctx.bridge
        .call("store.set", { key: key(coll.path), value: { path: coll.path, hashes: [] } })
        .catch(() => {});
    },
  };

  // Saving a script the person changed allows it.
  const save = S.save;
  S.save = async (/** @type {Tab} */ tab) => {
    const before = tab.ref ? S.collections.byPath(tab.ref.collection) : undefined;
    const node = before && tab.ref ? S.collections.locate(before, tab.ref.path)?.node : undefined;
    const old =
      tab.kind === "group"
        ? scriptsOf(node?.type === "folder" ? node.meta : before?.meta)
        : node?.type === "request"
          ? scriptsOf(node.req)
          : undefined;
    const ok = await save(tab);
    const coll = ok && tab.ref ? S.collections.byPath(tab.ref.collection) : undefined;
    if (coll) {
      const now = scriptsOf(tab.req);
      const changed = /** @type {const} */ (["pre", "post", "tests"])
        .filter((k) => !old || old[k] !== now[k])
        .map((k) => now[k]);
      if (changed.some((t) => t.trim())) await allow(coll.path, changed);
    }
    return ok;
  };

  const menu = S.collectionMenu;
  S.collectionMenu = (/** @type {Collection} */ coll, /** @type {any[]} */ adds) => {
    const items = menu(coll, adds);
    if (!scriptsIn(coll).length) return items;
    const at = Math.max(0, items.lastIndexOf("-"));
    items.splice(
      at,
      0,
      { label: "Allow its scripts", icon: "shield", run: () => S.trust.allowAll(coll) },
      { label: "Stop running its scripts", icon: "stop", run: () => S.trust.revoke(coll) },
    );
    return items;
  };
}
