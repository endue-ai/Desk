// The tree pane: one row per open node, drawn as a virtual list, with containers opened on demand
// (their children are built then), containers of more than 100 children opened in groups of 100,
// a collapsed node's child count, and the keys of the WAI-ARIA tree pattern. A masked value draws
// as dots; its text never enters the DOM until the person reveals it.

import { isMasked } from "./secrets.js";
import { childrenOf, countOf, isBranch, previewOf } from "./tree.js";
import { createVirtual } from "./virtual.js";

/**
 * @typedef {import("./tree.js").DataNode} DataNode
 * @typedef {import("./tree.js").DataDoc} DataDoc
 * @typedef {object} Row
 * @property {string} key Its path: root index, then child indexes, groups as [from-to]
 * @property {string} label
 * @property {number} level
 * @property {DataNode[]} chain The nodes from the root to this one (for a group, to its container)
 * @property {{ from: number, to: number }} [group]
 * @property {number} setsize
 * @property {number} posinset
 * @typedef {{ expanded: Set<string>, selected: string | null }} TreeState
 * @typedef {{ select(row: Row): void, status(text: string): void, reveal(row: Row): void }} TreeHooks
 */

export const GROUP = 100;
export const MASK = "••••••••";
const ROW_HEIGHT = 22;
const MAX_EXPANDED = 20_000;
const QUIET_TAGS = new Set(["attribute", "text", "cdata", "block"]);

/** The group size for `n` children: 100, 10 000, ... so that no level shows more than 100 rows. */
const bucketOf = (/** @type {number} */ n) => {
  let bucket = GROUP;
  while (bucket * GROUP < n) bucket *= GROUP;
  return bucket;
};

/**
 * The keys of the groups that hold child `index` of a container with `count` children.
 * @param {string} key The container's key
 * @param {number} count
 * @param {number} index
 */
export function groupKeys(key, count, index) {
  const keys = [];
  let at = key;
  let from = 0;
  let to = count;
  while (to - from > GROUP) {
    const bucket = bucketOf(to - from);
    const start = from + Math.floor((index - from) / bucket) * bucket;
    from = start;
    to = Math.min(start + bucket, to);
    at = `${at}/[${from}-${to}]`;
    keys.push(at);
  }
  return keys;
}

/**
 * @param {Document} doc
 * @param {HTMLElement} el The tree element (role tree), which scrolls.
 * @param {TreeHooks} hooks
 */
export function createTreeView(doc, el, hooks) {
  /** @type {DataDoc | null} */
  let data = null;
  /** @type {TreeState} */
  let state = { expanded: new Set(), selected: null };
  /** @type {Row[]} */
  let rows = [];
  /** @type {Map<string, number>} */
  let index = new Map();
  let maskKeys = true;
  /** @type {string | null} */
  let revealed = null;
  /** While "Expand all" builds the rows: the keys it opened. @type {Set<string> | null} */
  let opening = null;

  const isOpen = (/** @type {string} */ key) => {
    if (!opening) return state.expanded.has(key);
    if (rows.length >= MAX_EXPANDED) return false;
    opening.add(key);
    return true;
  };

  const rootLabel = (/** @type {DataNode} */ root, /** @type {number} */ i) => {
    if (!data || data.roots.length === 1) return "root";
    if (data.rootLabel === "Line") return `Line ${root.line}`;
    return `${data.rootLabel ?? "Document"} ${i + 1}`;
  };

  /**
   * @param {DataNode[]} chain
   * @param {string} nodeKey
   * @param {string} at The key children are listed under: the node's, or a group's
   * @param {number} level
   * @param {number} from
   * @param {number} to
   */
  const addChildren = (chain, nodeKey, at, level, from, to) => {
    const node = /** @type {DataNode} */ (chain.at(-1));
    const children = childrenOf(node);
    const n = to - from;
    if (n > GROUP) {
      const bucket = bucketOf(n);
      const setsize = Math.ceil(n / bucket);
      for (let start = from, pos = 1; start < to; start += bucket, pos++) {
        const end = Math.min(start + bucket, to);
        const key = `${at}/[${start}-${end}]`;
        rows.push({
          key,
          label: `[${start} … ${end - 1}]`,
          level,
          chain,
          group: { from: start, to: end },
          setsize,
          posinset: pos,
        });
        if (isOpen(key)) addChildren(chain, nodeKey, key, level + 1, start, end);
      }
      return;
    }
    for (let i = from; i < to; i++) {
      const child = /** @type {DataNode} */ (children[i]);
      const label = node.kind === "array" ? String(i) : String(child.key ?? i);
      addNode([...chain, child], `${nodeKey}/${i}`, label, level, n, i - from + 1);
    }
  };

  /**
   * @param {DataNode[]} chain
   * @param {string} key
   * @param {string} label
   * @param {number} level
   * @param {number} setsize
   * @param {number} posinset
   */
  const addNode = (chain, key, label, level, setsize, posinset) => {
    rows.push({ key, label, level, chain, setsize, posinset });
    const node = /** @type {DataNode} */ (chain.at(-1));
    if (isBranch(node) && isOpen(key))
      addChildren(chain, key, key, level + 1, 0, countOf(node) || childrenOf(node).length);
  };

  const build = () => {
    rows = [];
    const roots = data?.roots ?? [];
    roots.forEach((root, i) => {
      addNode([root], String(i), rootLabel(root, i), 1, roots.length, i + 1);
    });
    index = new Map(rows.map((row, i) => [row.key, i]));
    if (state.selected === null || !index.has(state.selected))
      state.selected = rows[0]?.key ?? null;
    virtual.setCount(rows.length);
  };

  const rowOf = (/** @type {number} */ i) => rows[i];
  const isBranchRow = (/** @type {Row} */ row) =>
    row.group !== undefined || isBranch(/** @type {DataNode} */ (row.chain.at(-1)));
  const expanded = (/** @type {Row} */ row) => isBranchRow(row) && state.expanded.has(row.key);

  /** One row's element. */
  const drawRow = (/** @type {Row} */ row, /** @type {number} */ i) => {
    const item = doc.createElement("div");
    item.className = "row";
    item.id = `row-${i}`;
    item.setAttribute("role", "treeitem");
    item.setAttribute("aria-level", String(row.level));
    item.setAttribute("aria-setsize", String(row.setsize));
    item.setAttribute("aria-posinset", String(row.posinset));
    item.setAttribute("aria-selected", String(row.key === state.selected));
    item.dataset.key = row.key;
    item.style.paddingLeft = `${(row.level - 1) * 16 + 4}px`;
    const twisty = doc.createElement("span");
    twisty.className = "twisty";
    twisty.setAttribute("aria-hidden", "true");
    if (isBranchRow(row)) {
      item.setAttribute("aria-expanded", String(expanded(row)));
      twisty.textContent = expanded(row) ? "▾" : "▸";
    }
    const key = doc.createElement("span");
    key.className = "key";
    key.textContent = row.label;
    item.append(twisty, key);
    const node = /** @type {DataNode} */ (row.chain.at(-1));
    const value = doc.createElement("span");
    if (row.group) {
      value.className = "value count";
      value.textContent = `${(row.group.to - row.group.from).toLocaleString("en-US")} items`;
      item.append(value);
      return item;
    }
    const sep = doc.createElement("span");
    sep.className = "sep";
    sep.textContent = isBranch(node) ? " " : ": ";
    const masked = isMasked(row.chain, maskKeys) && revealed !== row.key;
    value.className = `value kind-${node.kind}${masked ? " masked" : ""}`;
    value.textContent = masked ? MASK : previewOf(node);
    item.append(sep, value);
    const badge = (/** @type {string} */ text, /** @type {string} */ kind, title = "") => {
      const b = doc.createElement("span");
      b.className = `badge ${kind}`;
      b.textContent = text;
      if (title) b.title = title;
      item.append(b);
    };
    if (node.tag && !QUIET_TAGS.has(node.tag)) badge(node.tag, "tag");
    if (node.anchor) badge(`&${node.anchor}`, "anchor");
    if (node.alias) badge(`*${node.alias}`, "alias", `Shows the node anchored as ${node.alias}`);
    if (node.duplicate)
      badge("duplicate key", "warn", "This key appears earlier in the same object");
    if (node.error) badge("does not parse", "error", node.error);
    if (masked) {
      const reveal = doc.createElement("button");
      reveal.type = "button";
      reveal.className = "reveal";
      reveal.tabIndex = -1;
      reveal.textContent = "Reveal";
      reveal.setAttribute("aria-label", `Reveal the value of ${row.label}`);
      reveal.addEventListener("click", (event) => {
        event.stopPropagation();
        select(i);
        hooks.reveal(row);
      });
      item.append(reveal);
    }
    return item;
  };

  const virtual = createVirtual(el, ROW_HEIGHT, (first, last) => {
    const items = [];
    for (let i = first; i < last; i++) {
      const row = rowOf(i);
      if (row) items.push(drawRow(row, i));
    }
    virtual.window.replaceChildren(...items);
    const at = state.selected === null ? undefined : index.get(state.selected);
    if (at !== undefined && at >= first && at < last)
      el.setAttribute("aria-activedescendant", `row-${at}`);
    else el.removeAttribute("aria-activedescendant");
  });

  /** Select row `i`, scroll it into view and tell the view. */
  const select = (/** @type {number} */ i) => {
    const row = rowOf(Math.max(0, Math.min(rows.length - 1, i)));
    if (!row) return;
    state.selected = row.key;
    virtual.reveal(/** @type {number} */ (index.get(row.key)));
    virtual.render();
    hooks.select(row);
  };

  const toggle = (/** @type {Row} */ row, open = !expanded(row)) => {
    if (!isBranchRow(row)) return;
    if (open) state.expanded.add(row.key);
    else state.expanded.delete(row.key);
    build();
    virtual.render();
  };

  const selectedIndex = () => (state.selected === null ? 0 : (index.get(state.selected) ?? 0));

  el.addEventListener("click", (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    const item = /** @type {HTMLElement | null} */ (target.closest("[role=treeitem]"));
    const at = item?.dataset.key === undefined ? undefined : index.get(item.dataset.key);
    if (at === undefined) return;
    const row = /** @type {Row} */ (rowOf(at));
    if (target.classList.contains("twisty")) toggle(row);
    select(at);
  });

  el.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const i = selectedIndex();
    const row = rowOf(i);
    if (!row) return;
    const page = Math.max(1, virtual.rowsInView() - 1);
    const keys = {
      ArrowDown: () => select(i + 1),
      ArrowUp: () => select(i - 1),
      Home: () => select(0),
      End: () => select(rows.length - 1),
      PageDown: () => select(i + page),
      PageUp: () => select(i - page),
      ArrowRight: () => {
        if (!isBranchRow(row)) return;
        if (!expanded(row)) toggle(row, true);
        else if (rowOf(i + 1)?.level === row.level + 1) select(i + 1);
      },
      ArrowLeft: () => {
        if (expanded(row)) return toggle(row, false);
        for (let up = i - 1; up >= 0; up--)
          if ((rowOf(up)?.level ?? 0) < row.level) return select(up);
      },
      Enter: () => toggle(row),
      " ": () => toggle(row),
    };
    const act = keys[/** @type {keyof typeof keys} */ (event.key)];
    if (!act) return;
    event.preventDefault();
    act();
  });

  return {
    /**
     * Show a document with its saved state (which nodes are open, which is selected).
     * @param {DataDoc | null} next
     * @param {TreeState} saved
     * @param {boolean} keys The key rule of masking is on.
     */
    load(next, saved, keys) {
      data = next;
      state = saved;
      maskKeys = keys;
      revealed = null;
      el.scrollTop = 0;
      build();
      const at = selectedIndex();
      virtual.reveal(at);
      virtual.render();
      const row = rowOf(at);
      if (row) hooks.select(row);
    },
    /** Redraw with the masking rule and the one revealed row. */
    mask(/** @type {boolean} */ keys, /** @type {string | null} */ shown) {
      maskKeys = keys;
      revealed = shown;
      virtual.render();
    },
    expandAll() {
      opening = new Set();
      build();
      state.expanded = opening;
      opening = null;
      const capped = rows.length >= MAX_EXPANDED;
      build();
      virtual.render();
      const max = MAX_EXPANDED.toLocaleString("en-US");
      hooks.status(
        capped ? `Opened the first ${max} rows; open the rest one by one.` : "Opened every node.",
      );
    },
    collapseAll() {
      state.expanded.clear();
      const root = state.selected?.split("/")[0] ?? "0";
      state.selected = root;
      build();
      el.scrollTop = 0;
      virtual.render();
      const row = rowOf(index.get(root) ?? 0);
      if (row) hooks.select(row);
    },
    /** Open the tree down to the node at `path` (root index, then child indexes) and select it. */
    reveal(/** @type {number[]} */ path) {
      const [root, ...rest] = path;
      if (root === undefined || !data?.roots[root]) return;
      let key = String(root);
      let node = /** @type {DataNode} */ (data.roots[root]);
      for (const i of rest) {
        state.expanded.add(key);
        for (const group of groupKeys(key, childrenOf(node).length, i)) state.expanded.add(group);
        node = /** @type {DataNode} */ (childrenOf(node)[i]);
        key = `${key}/${i}`;
        if (!node) return;
      }
      state.selected = key;
      build();
      select(index.get(key) ?? 0);
    },
    focus() {
      el.focus();
    },
    selected: () => (state.selected === null ? undefined : rowOf(index.get(state.selected) ?? -1)),
  };
}
