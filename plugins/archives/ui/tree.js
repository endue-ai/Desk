// The archive as a tree for the view: folders and files with sizes and dates, sorted by name, size
// or date (folders first), filtered by name, flattened to the rows that are open. No DOM.
import { formatSize } from "./bytes.js";
import { baseName, outside, parentOf } from "./formats/archive.js";

/** @typedef {import("./formats/archive.js").Entry} Entry */
/**
 * @typedef {{ id: string, name: string, kind: Entry["kind"], entry?: Entry, children: Node[],
 *   size: number, files: number, date?: Date }} Node
 * @typedef {{ by: "name" | "size" | "date", descending: boolean }} Sort
 * @typedef {{
 *   id: string, name: string, depth: number, kind: Entry["kind"], size: number, packed?: number,
 *   date: string, method: string, encrypted: boolean, link?: string, outside: boolean,
 *   expanded?: boolean, marked: boolean, setsize: number, posinset: number,
 * }} Row
 */

/** @param {Entry[]} entries */
export function buildTree(entries) {
  /** @type {Node} */
  const root = { id: "", name: "", kind: "folder", children: [], size: 0, files: 0 };
  /** @type {Map<string, Node>} */
  const byId = new Map([["", root]]);
  for (const entry of entries) {
    const unsafe = outside(entry.path);
    /** @type {Node} */
    const node = {
      id: entry.path,
      name: unsafe ? entry.path : baseName(entry.path),
      kind: entry.kind,
      entry,
      children: [],
      size: entry.kind === "folder" ? 0 : Math.max(0, entry.size),
      files: entry.kind === "folder" ? 0 : 1,
    };
    if (entry.date) node.date = entry.date;
    byId.set(entry.path, node);
  }
  for (const node of byId.values()) {
    if (node === root) continue;
    const parent = (outside(node.id) ? root : byId.get(parentOf(node.id))) ?? root;
    parent.children.push(node);
  }
  /** Folder sizes and file counts are their contents'. @param {Node} node */
  const total = (node) => {
    for (const c of node.children) {
      if (c.kind === "folder") total(c);
      node.size += c.size;
      node.files += c.files;
    }
  };
  total(root);
  return { root, byId };
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** @param {Sort} sort */
function compare(sort) {
  const sign = sort.descending ? -1 : 1;
  /** @param {Node} a @param {Node} b */
  const byName = (a, b) =>
    collator.compare(a.name, b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  /** @param {Node} a @param {Node} b */
  return (a, b) => {
    const folders = Number(b.kind === "folder") - Number(a.kind === "folder");
    if (folders) return folders;
    let order = 0;
    if (sort.by === "size") order = a.size - b.size;
    else if (sort.by === "date") order = (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0);
    return sign * (order || byName(a, b));
  };
}

/** "2026-10-01 12:00", in local time. @param {Date | undefined} date */
export function formatDate(date) {
  if (!date || Number.isNaN(date.getTime())) return "";
  const p = (/** @type {number} */ n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

/**
 * The rows on screen: open folders' children in order; with a filter, the files whose names hold
 * it and the folders on their way, open.
 * @param {Node} root
 * @param {{ expanded: Set<string>, marked: Set<string>, sort: Sort, filter: string }} state
 */
export function visibleRows(root, state) {
  const order = compare(state.sort);
  const needle = state.filter.trim().toLowerCase();
  /** @type {Map<Node, boolean>} */
  const matches = new Map();
  /** @param {Node} node @returns {boolean} */
  const match = (node) => {
    const known = matches.get(node);
    if (known !== undefined) return known;
    const self = node.name.toLowerCase().includes(needle);
    const hit =
      node.kind === "folder" ? node.children.some(match) || (self && node !== root) : self;
    matches.set(node, hit);
    return hit;
  };
  /** @type {Row[]} */
  const rows = [];
  let files = 0;
  let size = 0;
  /** @param {Node} node @param {number} depth */
  const walk = (node, depth) => {
    const kids = (needle ? node.children.filter(match) : node.children).slice().sort(order);
    kids.forEach((child, i) => {
      const entry = child.entry;
      const folder = child.kind === "folder";
      const open = folder && (needle ? child.children.some(match) : state.expanded.has(child.id));
      /** @type {Row} */
      const row = {
        id: child.id,
        name: child.name,
        depth,
        kind: child.kind,
        size: folder ? child.size : (entry?.size ?? 0),
        date: formatDate(child.date),
        method: entry?.method ?? "",
        encrypted: entry?.encrypted === true,
        outside: outside(child.id),
        marked: state.marked.has(child.id),
        setsize: kids.length,
        posinset: i + 1,
      };
      if (entry?.packed !== undefined && !folder) row.packed = entry.packed;
      if (entry?.link !== undefined) row.link = entry.link;
      if (folder) row.expanded = open;
      else if (needle) {
        files++;
        size += row.size;
      }
      rows.push(row);
      if (open) walk(child, depth + 1);
    });
  };
  walk(root, 1);
  const folders = countFolders(root);
  const plural = (/** @type {number} */ n, /** @type {string} */ word) =>
    `${n} ${word}${n === 1 ? "" : "s"}`;
  const summary = needle
    ? `${files} of ${plural(root.files, "file")} match, ${formatSize(size)}`
    : `${plural(root.files, "file")}, ${plural(folders, "folder")}, ${formatSize(root.size)}`;
  return { rows, summary };
}

/** @param {Node} node @returns {number} */
const countFolders = (node) =>
  node.children.reduce((n, c) => n + (c.kind === "folder" ? 1 + countFolders(c) : 0), 0);

/** Every file and link under `node` (itself when it is one). @param {Node} node @returns {Entry[]} */
export function entriesUnder(node) {
  if (node.kind !== "folder") return node.entry ? [node.entry] : [];
  return node.children.flatMap(entriesUnder);
}
