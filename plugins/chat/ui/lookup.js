// Finding what a command or a key names: a message by its key (on screen, held, else read from
// the index), the person's last message in a composer's conversation or thread, the conversations
// the palette's typed words name, and the message keys the main area shows in order (j and k).
import { chatOf, isChat, messageRef } from "./model.js";
import { mainOf, threadOf } from "./present.js";

/**
 * @typedef {import("@endue-ai/bridge").MessageItem} MessageItem
 * @typedef {import("./state.js").State} State
 * @typedef {{ state: State, actions: ReturnType<typeof import("./actions.js").createActions> }} Deps
 */

/** @param {Deps} deps */
export function createLookup({ state: s, actions }) {
  /** A message by key: one on screen or held, else read from the index. */
  const message = async (/** @type {string | null} */ key) => {
    if (!key) throw new Error("Select a message first.");
    const held =
      [
        ...(s.open?.messages ?? []),
        ...(s.thread ? [s.thread.root, ...s.thread.replies] : []),
        ...s.timeline.messages,
        ...[...s.columns.values()].flatMap((c) => c.messages),
        ...s.sending.map((p) => p.message),
      ].find((m) => m.key === key) ?? s.recent.get(key);
    if (held) return held;
    const ref = messageRef(key);
    if (!ref) throw new Error(`${key} is not a message.`);
    const item = await actions.get(ref.source, ref.id);
    if (!item || !isChat(item)) throw new Error(`There is no chat message ${ref.id}.`);
    return chatOf(/** @type {MessageItem} */ (item));
  };
  /** The person's newest message in a thread's composer target, or in the open conversation. */
  const lastOwn = (/** @type {string | undefined} */ target) => {
    const pool = target?.startsWith("thread:")
      ? (s.thread?.replies ?? [])
      : (s.open?.messages ?? []).filter((m) => !m.isReply || m.broadcast);
    return [...pool].filter((m) => m.self).sort((a, b) => b.time - a.time)[0];
  };

  /** The palette's answers for typed words: the conversations whose names hold them. */
  const find = (/** @type {string} */ query, /** @type {number} */ limit) => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const results = s.conversations
      .filter((c) => {
        const text = `${c.name} ${c.workspace} ${c.platform.name}`.toLowerCase();
        return words.length > 0 && words.every((w) => text.includes(w));
      })
      .slice(0, Math.min(Math.max(limit, 1), 50))
      .map((c) => ({
        id: c.key,
        title: c.kind === "dm" || c.kind === "group" ? c.name : `#${c.name}`,
        detail: `${c.platform.name} · ${c.workspace}${c.unread ? ` · ${c.unread} unread` : ""}`,
        kind: "chat",
        actions: [
          {
            command: "endue.chat.conversation",
            title: "Open in Chat",
            args: { conversation: c.key },
          },
          { command: "endue.chat.mark-read", title: "Mark read", args: { conversation: c.key } },
        ],
      }));
    return { results };
  };

  /** The message keys of the main area in the order they show, for j and k. */
  const keysOnScreen = (/** @type {string} */ where) => {
    if (where === "thread") {
      const t = threadOf(s);
      return t ? [t.root.key, ...t.rows.flatMap((r) => (r.type === "message" ? [r.key] : []))] : [];
    }
    const main = mainOf(s);
    const panes =
      main.layout === "conversation"
        ? main.pane
          ? [main.pane]
          : []
        : main.layout === "inbox"
          ? main.cards
          : main.layout === "columns"
            ? main.columns
            : [];
    const rows = main.layout === "timeline" ? main.rows : panes.flatMap((p) => p.rows);
    return rows.flatMap((r) => (r.type === "message" && !r.message.pending ? [r.key] : []));
  };

  return { message, lastOwn, find, keysOnScreen };
}
