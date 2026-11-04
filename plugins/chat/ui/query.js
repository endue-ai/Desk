// The item queries the chat plugin reads the index with (specs/item/v0 `ItemQuery`), and the
// smart filters and layouts the person picks from. Every query carries CHAT, so mail never shows
// here, and the mail plugin's mailboxes carry its opposite. Pure functions.
import { isDirect } from "./model.js";

/**
 * @typedef {import("@endue-ai/bridge").ItemQuery} ItemQuery
 * @typedef {import("@endue-ai/bridge").ItemCondition} ItemCondition
 * @typedef {import("./model.js").ChatMessage} ChatMessage
 * @typedef {import("./model.js").Conversation} Conversation
 * @typedef {"all" | "unread" | "mentions" | "direct" | "saved"} FilterId
 * @typedef {{ id: FilterId, title: string, where: ItemCondition[] }} Filter
 * @typedef {"conversation" | "inbox" | "timeline" | "columns"} LayoutId
 */

/** A chat message names its channel; this condition keeps every chat query to chat. */
export const CHAT = /** @type {ItemCondition} */ ({ field: "raw.channel", op: "exists" });
const UNREAD = /** @type {ItemCondition} */ ({ field: "unread", op: "eq", value: true });
const MENTIONED = /** @type {ItemCondition} */ ({ field: "raw.mentioned", op: "eq", value: true });
const DIRECT = /** @type {ItemCondition} */ ({
  field: "raw.channelKind",
  op: "in",
  value: ["dm", "group"],
});

/** The smart filters, in the order the navigation shows them. Saved is the plugin's own list. */
export const FILTERS = /** @type {Filter[]} */ ([
  { id: "all", title: "All", where: [] },
  { id: "unread", title: "Unread", where: [UNREAD] },
  { id: "mentions", title: "Mentions", where: [MENTIONED] },
  { id: "direct", title: "Direct", where: [DIRECT] },
  { id: "saved", title: "Saved", where: [] },
]);
export const filterOf = (/** @type {unknown} */ id) => FILTERS.find((f) => f.id === id);

/** The layouts, by the digit that switches to each. */
export const LAYOUTS = /** @type {Array<{ id: LayoutId, title: string, key: string }>} */ ([
  { id: "conversation", title: "Conversation", key: "1" },
  { id: "inbox", title: "Inbox", key: "2" },
  { id: "timeline", title: "Timeline", key: "3" },
  { id: "columns", title: "Columns", key: "4" },
]);
export const layoutOf = (/** @type {unknown} */ id) => LAYOUTS.find((l) => l.id === id);

/** Narrowed to some accounts, when a service is picked. */
const among = (/** @type {string[] | undefined} */ sources) =>
  sources && sources.length > 0 ? { sources } : {};

/** The newest chat messages of every account: the conversations and their latest message. */
export const recentQuery = (/** @type {string[] | undefined} */ sources) =>
  /** @type {ItemQuery} */ ({
    kinds: ["message"],
    ...among(sources),
    where: [CHAT],
    sort: [{ field: "receivedAt", dir: "desc" }],
    limit: 500,
  });

/** The unread chat messages: the counts and the Inbox's cards. */
export const unreadQuery = (/** @type {string[] | undefined} */ sources) =>
  /** @type {ItemQuery} */ ({
    kinds: ["message"],
    ...among(sources),
    where: [CHAT, UNREAD],
    sort: [{ field: "receivedAt", dir: "desc" }],
    limit: 500,
  });

/**
 * One conversation's messages, newest first a page at a time (shown oldest first).
 * @param {{ source: Conversation["source"], channel: string }} conversation
 * @param {number} page
 * @param {string} [cursor]
 */
export const conversationQuery = ({ source, channel }, page, cursor) =>
  /** @type {ItemQuery} */ ({
    kinds: ["message"],
    sources: [`${source.connector}/${source.instance}`],
    where: [{ field: "raw.channel", op: "eq", value: channel }],
    sort: [{ field: "receivedAt", dir: "desc" }],
    limit: page,
    ...(cursor ? { cursor } : {}),
  });

/** A thread's messages, the root's replies oldest first. @param {ChatMessage} root */
export const threadQuery = (root) =>
  /** @type {ItemQuery} */ ({
    kinds: ["message"],
    sources: [`${root.source.connector}/${root.source.instance}`],
    where: [
      { field: "raw.channel", op: "eq", value: root.channel },
      { field: "thread", op: "eq", value: root.thread ?? root.id },
    ],
    sort: [{ field: "receivedAt", dir: "asc" }],
    limit: 200,
  });

/**
 * The Timeline's messages: every account's, or one service's, under a filter and a search.
 * @param {{ filter: FilterId, text?: string, sources?: string[], page: number, cursor?: string }} o
 */
export function timelineQuery({ filter, text, sources, page, cursor }) {
  const smart = filterOf(filter) ?? FILTERS[0];
  return /** @type {ItemQuery} */ ({
    kinds: ["message"],
    ...among(sources),
    ...(text ? { text } : {}),
    where: [CHAT, .../** @type {Filter} */ (smart).where],
    sort: [{ field: "receivedAt", dir: "desc" }],
    limit: page,
    ...(cursor ? { cursor } : {}),
  });
}

/**
 * Whether a message belongs under a filter as the person sees it now, for live changes.
 * @param {ChatMessage} m
 * @param {FilterId} filter
 * @param {Set<string>} saved
 */
export function passes(m, filter, saved) {
  switch (filter) {
    case "unread":
      return m.unread;
    case "mentions":
      return m.mentioned;
    case "direct":
      return isDirect(m);
    case "saved":
      return saved.has(m.key);
    default:
      return true;
  }
}

/** Every word of a search in the message's text or title, in any case, as the index judges it. */
export function says(/** @type {ChatMessage} */ m, /** @type {string} */ text) {
  const haystack = `${m.title}\n${m.text}`.toLowerCase();
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

/**
 * Whether a conversation shows in the navigation under a filter.
 * @param {Conversation} c
 * @param {FilterId} filter
 */
export function listed(c, filter) {
  if (filter === "unread") return c.unread > 0;
  if (filter === "mentions") return c.mentions > 0;
  if (filter === "direct") return c.kind === "dm" || c.kind === "group";
  return true;
}
