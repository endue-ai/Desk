// A thread is a tree of messages: editing a question or asking again adds a sibling, and each node
// remembers which child is shown, so every version stays and the conversation is the path through
// the chosen ones.

/**
 * @typedef {import("./chat-types.js").Image} Image
 * @typedef {import("./chat-types.js").Stats} Stats
 * @typedef {import("./chat-types.js").ToolCall} ToolCall
 * @typedef {{
 *   id: string,
 *   parent: string | null,
 *   role: "user" | "assistant" | "tool",
 *   content: string,
 *   reasoning?: string,
 *   images?: Image[],
 *   files?: { name: string, path?: string, chars: number }[],
 *   model?: string,
 *   modelName?: string,
 *   stats?: Stats,
 *   error?: string,
 *   toolCalls?: ToolCall[],
 *   toolCallId?: string,
 *   reasoningMs?: number,
 *   edited?: boolean,
 *   createdAt: number,
 *   children: string[],
 *   pick: number,
 * }} Node
 * @typedef {{
 *   id: string,
 *   title: string,
 *   titled?: boolean,
 *   createdAt: number,
 *   updatedAt: number,
 *   model?: string,
 *   system?: string,
 *   preset?: string,
 *   params?: import("./chat-types.js").Sampling,
 *   think?: boolean,
 *   pinned?: boolean,
 *   roots: string[],
 *   pick: number,
 *   nodes: Record<string, Node>,
 * }} Thread
 * @typedef {Pick<Thread, "id" | "title" | "createdAt" | "updatedAt" | "model" | "pinned"> & { preview?: string }} ThreadEntry
 */

/** A short random id. */
export function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return [...bytes]
    .map((b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 14);
}

/** @param {{ model?: string, system?: string, now?: number }} [options] @returns {Thread} */
export function createThread(options = {}) {
  const now = options.now ?? Date.now();
  return {
    id: `${now.toString(36)}-${newId().slice(0, 6)}`,
    title: "New chat",
    createdAt: now,
    updatedAt: now,
    model: options.model,
    system: options.system,
    roots: [],
    pick: 0,
    nodes: {},
  };
}

/** The nodes shown, root to leaf. @param {Thread} thread @returns {Node[]} */
export function path(thread) {
  /** @type {Node[]} */
  const out = [];
  let ids = thread.roots;
  let pick = thread.pick;
  while (ids.length) {
    const node = thread.nodes[ids[Math.min(pick, ids.length - 1)]];
    if (!node) break;
    out.push(node);
    ids = node.children;
    pick = node.pick;
  }
  return out;
}

/** The last node shown. @param {Thread} thread */
export const leaf = (thread) => path(thread).at(-1);

/** A node's siblings, itself among them. @param {Thread} thread @param {Node} node */
export function siblings(thread, node) {
  return node.parent === null ? thread.roots : (thread.nodes[node.parent]?.children ?? []);
}

/**
 * Add a node under `parent` (null for a first message) and show it.
 * @param {Thread} thread @param {string | null} parent @param {Omit<Node, "id" | "parent" | "children" | "pick" | "createdAt"> & { createdAt?: number }} fields
 */
export function addNode(thread, parent, fields) {
  const node = /** @type {Node} */ ({
    createdAt: Date.now(),
    ...fields,
    id: newId(),
    parent,
    children: [],
    pick: 0,
  });
  thread.nodes[node.id] = node;
  if (parent === null) {
    thread.roots.push(node.id);
    thread.pick = thread.roots.length - 1;
  } else {
    const up = thread.nodes[parent];
    up.children.push(node.id);
    up.pick = up.children.length - 1;
  }
  thread.updatedAt = Date.now();
  return node;
}

/** Show the sibling `delta` away from a node (‹ ›). @param {Thread} thread @param {string} id @param {number} delta */
export function switchBranch(thread, id, delta) {
  const node = thread.nodes[id];
  if (!node) return;
  const list = siblings(thread, node);
  const at = list.indexOf(id);
  const next = Math.max(0, Math.min(list.length - 1, at + delta));
  if (node.parent === null) thread.pick = next;
  else thread.nodes[node.parent].pick = next;
}

/** Where a node stands among its siblings, from 1. @param {Thread} thread @param {Node} node */
export function branchOf(thread, node) {
  const list = siblings(thread, node);
  return { index: list.indexOf(node.id) + 1, count: list.length };
}

/** Remove a node and everything under it. @param {Thread} thread @param {string} id */
export function removeNode(thread, id) {
  const node = thread.nodes[id];
  if (!node) return;
  const list = siblings(thread, node);
  const at = list.indexOf(id);
  list.splice(at, 1);
  if (node.parent === null) thread.pick = Math.max(0, Math.min(thread.pick, list.length - 1));
  else {
    const up = thread.nodes[node.parent];
    up.pick = Math.max(0, Math.min(up.pick, list.length - 1));
  }
  const drop = [id];
  while (drop.length) {
    const next = /** @type {string} */ (drop.pop());
    drop.push(...(thread.nodes[next]?.children ?? []));
    delete thread.nodes[next];
  }
  thread.updatedAt = Date.now();
}

/** The path up to and including a node. @param {Thread} thread @param {string} id */
export function pathTo(thread, id) {
  /** @type {Node[]} */
  const out = [];
  let node = thread.nodes[id];
  while (node) {
    out.unshift(node);
    node = node.parent === null ? undefined : thread.nodes[node.parent];
  }
  return out;
}

/** The entry the thread list keeps. @param {Thread} thread @returns {ThreadEntry} */
export function entryOf(thread) {
  const last = path(thread).findLast((n) => n.role === "user" || n.role === "assistant");
  return {
    id: thread.id,
    title: thread.title,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    model: thread.model,
    pinned: thread.pinned,
    preview: last?.content
      .replace(/<think>[\s\S]*?<\/think>/g, "")
      .replace(/```[\s\S]*?(```|$)/g, " ")
      .replace(/[*_`#>|]+/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120),
  };
}

/** A title from a first message: its first line, cut at a word. @param {string} text */
export function titleFrom(text) {
  const line = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (line.length <= 48) return line || "New chat";
  const cut = line.slice(0, 48);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 24))}…`;
}

const DAY = 86_400_000;

/**
 * The list's groups, newest first: Pinned, Today, Yesterday, Previous 7 days, Previous 30 days,
 * then by month.
 * @param {ThreadEntry[]} entries @param {number} [now]
 */
export function groupThreads(entries, now = Date.now()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const today = start.getTime();
  /** @type {Map<string, ThreadEntry[]>} */
  const groups = new Map();
  const put = (/** @type {string} */ name, /** @type {ThreadEntry} */ e) => {
    const list = groups.get(name) ?? [];
    list.push(e);
    groups.set(name, list);
  };
  for (const e of [...entries].sort((a, b) => b.updatedAt - a.updatedAt)) {
    if (e.pinned) put("Pinned", e);
    else if (e.updatedAt >= today) put("Today", e);
    else if (e.updatedAt >= today - DAY) put("Yesterday", e);
    else if (e.updatedAt >= today - 7 * DAY) put("Previous 7 days", e);
    else if (e.updatedAt >= today - 30 * DAY) put("Previous 30 days", e);
    else
      put(
        new Date(e.updatedAt).toLocaleDateString(undefined, { year: "numeric", month: "long" }),
        e,
      );
  }
  const order = ["Pinned", "Today", "Yesterday", "Previous 7 days", "Previous 30 days"];
  return [...groups.entries()].sort(
    ([a], [b]) =>
      (order.includes(a) ? order.indexOf(a) : 99) - (order.includes(b) ? order.indexOf(b) : 99),
  );
}
