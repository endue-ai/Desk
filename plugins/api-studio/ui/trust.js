// Which scripts may run. A collection opened from a folder can come from anyone (a clone, a
// download), and its scripts read every variable, secrets included, and can change where a
// request goes. So a script runs only when the person wrote it here or allowed it: the studio
// keeps the SHA-256 of every allowed script in the desk's store, and checks each script a send
// would run by its text, wherever the tab came from (a collection, the history, a duplicate). A
// script that arrives or changes on disk (a pull) has a new hash and is asked about again.

import { h } from "./dom.js";
import { dialog } from "./menu.js";
import { sha256 } from "./sha256.js";

/**
 * @typedef {import("./studio.js").Studio} Studio
 * @typedef {import("./app.js").Tab} Tab
 * @typedef {import("./collection-fs.js").Collection} Collection
 * @typedef {import("./collection-fs.js").Node} Node
 */

/** The most hashes kept (the store keeps 64 KiB a key). */
const KEEP = 900;
const KEY = "trust";

/** A request's or group's scripts. @param {any} r @returns {string[]} */
const scriptsOf = (r) => [
  String(r?.scripts?.pre ?? ""),
  String(r?.scripts?.post ?? ""),
  String(r?.tests ?? ""),
];

/** Every script a collection's files hold. @param {Collection} coll @returns {string[]} */
export function scriptsIn(coll) {
  /** @type {string[]} */
  const out = [...scriptsOf(coll.meta)];
  const walk = (/** @type {Node[]} */ nodes) => {
    for (const n of nodes) {
      if (n.type === "folder") {
        out.push(...scriptsOf(n.meta));
        walk(n.children);
      } else out.push(...scriptsOf(n.req));
    }
  };
  walk(coll.children);
  return out.filter((t) => t.trim());
}

/** @param {Studio} S */
export function installTrust(S) {
  /** @type {string[] | undefined} hashes allowed, oldest first */
  let allowed;
  /** Which of a tab's scripts the person edited in this session (pre, post, tests): theirs. @type {Map<string, Set<string>>} */
  const edited = new Map();
  /** The scripts of a tab the person edited. @param {Tab} tab */
  const theirs = (tab) => {
    const fields = edited.get(tab.id);
    if (!fields) return [];
    const [pre, post, tests] = scriptsOf(tab.req);
    return [
      ...(fields.has("pre") ? [pre] : []),
      ...(fields.has("post") ? [post] : []),
      ...(fields.has("tests") ? [tests] : []),
    ]
      .map(String)
      .filter((t) => t.trim());
  };
  /** Collections, or tabs, the person said no to in this session. @type {Set<string>} */
  const declined = new Set();
  /** @type {Map<string, Promise<boolean>>} */
  const asking = new Map();

  const load = async () => {
    if (!allowed) {
      let kept;
      try {
        kept = (await S.ctx.bridge.call("store.get", { key: KEY }))?.value;
      } catch {
        kept = undefined;
      }
      allowed = Array.isArray(kept?.hashes) ? kept.hashes.map(String) : [];
    }
    return /** @type {string[]} */ (allowed);
  };
  const keep = () =>
    S.ctx.bridge.call("store.set", { key: KEY, value: { hashes: allowed } }).catch(() => {});
  /** Allow these scripts from now on. @param {string[]} texts */
  const allow = async (texts) => {
    const fresh = new Set(texts.filter((t) => t.trim()).map(sha256));
    if (!fresh.size) return;
    allowed = [...(await load()).filter((x) => !fresh.has(x)), ...fresh].slice(-KEEP);
    await keep();
  };

  // What the person types or applies in a script editor is theirs.
  S.app.on("req", (/** @type {any} */ d) => {
    if (d?.field !== "scripts" && d?.field !== "tests") return;
    const tab = d.tab ?? S.app.current();
    const which = d.which ?? (d.field === "tests" ? "tests" : undefined);
    if (!tab || !which) return;
    // Tests the assistant added onto tests that came from a file stay the file's.
    if (
      typeof d.before === "string" &&
      d.before.trim() &&
      !(allowed ?? []).includes(sha256(d.before))
    )
      return;
    const fields = edited.get(tab.id) ?? new Set();
    fields.add(which);
    edited.set(tab.id, fields);
  });

  /** Every script a send of `tab` runs: its folders' and collection's, then its own. @param {Tab} tab */
  const toRun = (tab) => {
    const groups = (S.collections.parents(tab) ?? []).flatMap((/** @type {any} */ g) => [
      String(g.scripts?.pre ?? ""),
      String(g.scripts?.post ?? ""),
    ]);
    return {
      groups: groups.filter((t) => t.trim()),
      own: scriptsOf(tab.req).filter((t) => t.trim()),
    };
  };

  /** @param {string} name @param {string} where @param {boolean} changed */
  const ask = (name, where, changed) =>
    dialog({
      title: changed ? "Run these changed scripts?" : "Run these scripts?",
      className: "is-trust",
      body: [
        h(
          "p.as-dialog-text",
          null,
          changed
            ? `Scripts of “${name}” changed since you allowed them.`
            : `“${name}” has scripts that you did not write here.`,
        ),
        where ? h("p.as-dialog-text", null, h("code", null, where)) : null,
        h(
          "p.as-dialog-text",
          null,
          "Scripts read every variable, secrets included, and can change where a request goes. Run them only if you trust where they came from.",
        ),
      ].filter(Boolean),
      actions: [
        { label: "Don't run", value: () => false },
        { label: "Run scripts", kind: "desk-btn-primary", value: () => true },
      ],
    }).then((yes) => yes === true);

  S.trust = {
    /** Whether the scripts a send of `tab` would run may run; asks once for new ones. @param {Tab} tab */
    async allows(tab) {
      const { groups, own } = toRun(tab);
      // The person's own edits are theirs to run, and stay allowed.
      await allow(theirs(tab));
      const hashes = await load();
      const unknown = [...groups, ...own].filter((t) => !hashes.includes(sha256(t)));
      if (!unknown.length) return true;
      const coll = tab.ref ? S.collections.byPath(tab.ref.collection) : undefined;
      const key = coll ? coll.path : `tab:${tab.id}`;
      if (declined.has(key)) return false;
      const pending = asking.get(key);
      if (pending) return pending;
      const changed = !!coll && scriptsIn(coll).some((t) => hashes.includes(sha256(t)));
      const answer = ask(coll?.name ?? tab.req.name, coll?.path ?? "", changed).then(
        async (yes) => {
          if (yes) await allow([...(coll ? scriptsIn(coll) : []), ...unknown]);
          else declined.add(key);
          return yes;
        },
      );
      asking.set(key, answer);
      try {
        return await answer;
      } finally {
        asking.delete(key);
      }
    },
    /** Allow every script a collection holds now. @param {Collection} coll */
    async allowAll(coll) {
      declined.delete(coll.path);
      await allow(scriptsIn(coll));
    },
    /** Stop running a collection's scripts until the person allows them again. @param {Collection} coll */
    async revoke(coll) {
      const gone = new Set(scriptsIn(coll).map(sha256));
      allowed = (await load()).filter((x) => !gone.has(x));
      declined.add(coll.path);
      await keep();
    },
  };

  // Saving scripts the person edited keeps them allowed after a restart.
  const save = S.save;
  S.save = async (
    /** @type {Tab} */ tab,
    /** @type {import("./features-collections.js").SaveDestination | undefined} */ destination,
  ) => {
    const ok = await save(tab, destination);
    if (ok) await allow(theirs(tab));
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
