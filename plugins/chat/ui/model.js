// The chat plugin's model without its DOM or the bridge: what a chat message is (a `message` item
// of specs/item/v0 with `raw.channel`, the chat profile in docs/ko/chat-requirements.md), the keys
// that name messages and conversations, and the conversations a set of messages makes. Pure
// functions, so the tests run them in Node.
import { detectPlatform } from "./platforms.js";

/**
 * @typedef {import("@endue-ai/bridge").MessageItem} MessageItem
 * @typedef {import("@endue-ai/bridge").ItemSource} ItemSource
 * @typedef {import("./platforms.js").Platform} Platform
 * @typedef {"channel" | "private" | "dm" | "group"} ChannelKind
 * @typedef {{ emoji: string, count: number, self: boolean }} Reaction
 * @typedef {{ name: string, mime?: string, size?: number, url?: string }} Attachment
 * @typedef {{
 *   key: string, source: ItemSource, id: string, conversation: string, channel: string,
 *   channelName: string, channelKind: ChannelKind, platform: Platform, workspace: string,
 *   topic?: string, author: string, authorKey: string, at: string, time: number, text: string,
 *   title: string, unread: boolean, self: boolean, mentioned: boolean, bot: boolean,
 *   pinned: boolean, editedAt?: string, thread?: string, isReply: boolean, broadcast: boolean,
 *   replyCount: number, lastReplyAt?: string, reactions: Reaction[], attachments: Attachment[],
 *   deepLink?: string, item: MessageItem,
 * }} ChatMessage
 * A chat message as the plugin shows it. `thread` is the root's id; `isReply` when it is not the root.
 * @typedef {{
 *   key: string, source: ItemSource, channel: string, name: string, kind: ChannelKind,
 *   platform: Platform, workspace: string, topic?: string, latest: ChatMessage, unread: number,
 *   mentions: number, at: number,
 * }} Conversation
 */

export const KINDS = /** @type {ChannelKind[]} */ (["channel", "private", "dm", "group"]);
const DIRECT_KINDS = ["dm", "group"];

/** `connector/instance`, the source selector of one account. */
export const sourceKey = (/** @type {ItemSource} */ source) =>
  `${source.connector}/${source.instance}`;
/** The index key of a message: its source and id. */
export const messageKey = (/** @type {ItemSource} */ source, /** @type {string} */ id) =>
  `${sourceKey(source)}#${id}`;
/** The key of a conversation: its source and channel. */
export const conversationKey = (/** @type {ItemSource} */ source, /** @type {string} */ channel) =>
  `${sourceKey(source)}@${channel}`;

/** A conversation key back into its source and channel, or undefined. */
export function conversationRef(/** @type {string} */ key) {
  const slash = key.indexOf("/");
  const at = key.indexOf("@", slash + 1);
  if (slash <= 0 || at <= slash + 1 || at === key.length - 1) return undefined;
  return {
    source: { connector: key.slice(0, slash), instance: key.slice(slash + 1, at) },
    channel: key.slice(at + 1),
  };
}

/** A message key back into its source and id, or undefined. */
export function messageRef(/** @type {string} */ key) {
  const slash = key.indexOf("/");
  const hash = key.indexOf("#", slash + 1);
  if (slash <= 0 || hash <= slash + 1 || hash === key.length - 1) return undefined;
  return {
    source: { connector: key.slice(0, slash), instance: key.slice(slash + 1, hash) },
    id: key.slice(hash + 1),
  };
}

const string = (/** @type {unknown} */ value) =>
  typeof value === "string" && value.trim() !== "" ? value : undefined;
const count = (/** @type {unknown} */ value) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

/** Whether an item is a chat message: a message that names its channel. */
export function isChat(/** @type {{ kind?: string, raw?: unknown }} */ item) {
  if (item.kind !== "message") return false;
  const raw = /** @type {Record<string, unknown>} */ (item.raw ?? {});
  return string(raw.channel) !== undefined;
}

/** @param {unknown} value @returns {Reaction[]} */
function reactions(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((r) => {
    const { emoji, count: n, self } = /** @type {Record<string, unknown>} */ (r ?? {});
    const name = string(emoji);
    if (!name) return [];
    return [{ emoji: name.trim(), count: Math.max(1, count(n)), self: self === true }];
  });
}

/** @param {unknown} value @returns {Attachment[]} */
function attachments(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((a) => {
    const { name, mime, size, url } = /** @type {Record<string, unknown>} */ (a ?? {});
    const named = string(name);
    if (!named) return [];
    return [
      {
        name: named,
        ...(string(mime) ? { mime: /** @type {string} */ (mime) } : {}),
        ...(typeof size === "number" && size >= 0 ? { size } : {}),
        ...(string(url) ? { url: /** @type {string} */ (url) } : {}),
      },
    ];
  });
}

/**
 * A chat message item as the plugin shows it, every field of the chat profile read with its default.
 * @param {MessageItem} item an item for which isChat holds
 * @returns {ChatMessage}
 */
export function chatOf(item) {
  const raw = /** @type {Record<string, unknown>} */ (item.raw ?? {});
  const channel = string(raw.channel) ?? "";
  const kind = KINDS.includes(/** @type {ChannelKind} */ (raw.channelKind))
    ? /** @type {ChannelKind} */ (raw.channelKind)
    : "channel";
  const self = raw.self === true;
  const author = item.from?.name?.trim() || item.from?.email || "Unknown";
  const dmName = kind === "dm" && !self ? author : undefined;
  const text = item.body ?? item.snippet ?? item.title ?? "";
  const thread = string(item.thread);
  const at = item.receivedAt;
  return {
    key: messageKey(item.source, item.id),
    source: item.source,
    id: item.id,
    conversation: conversationKey(item.source, channel),
    channel,
    channelName: string(raw.channelName) ?? dmName ?? channel,
    channelKind: kind,
    platform: detectPlatform(raw.platform, item.source.connector),
    workspace: string(raw.workspace) ?? item.source.instance,
    ...(string(raw.topic) ? { topic: /** @type {string} */ (raw.topic) } : {}),
    author,
    authorKey: self ? "self" : `${item.from?.email ?? ""}|${author}`,
    at,
    time: Date.parse(at) || 0,
    text,
    title: item.title.trim() || text.split("\n")[0] || "",
    unread: item.unread === true,
    self,
    mentioned: raw.mentioned === true,
    bot: raw.bot === true,
    pinned: raw.pinned === true,
    ...(string(raw.editedAt) ? { editedAt: /** @type {string} */ (raw.editedAt) } : {}),
    ...(thread ? { thread } : {}),
    isReply: thread !== undefined && thread !== item.id,
    broadcast: raw.broadcast === true,
    replyCount: count(raw.replyCount),
    ...(string(raw.lastReplyAt) ? { lastReplyAt: /** @type {string} */ (raw.lastReplyAt) } : {}),
    reactions: reactions(raw.reactions),
    attachments: attachments(raw.attachments),
    ...(item.deepLink ? { deepLink: item.deepLink } : {}),
    item,
  };
}

/** Whether a message is a direct conversation's: a DM or a group DM. */
export const isDirect = (/** @type {{ channelKind: ChannelKind }} */ m) =>
  DIRECT_KINDS.includes(m.channelKind);

/** Newest first, ties by key, so every order is stable. */
export const newestFirst = (/** @type {ChatMessage} */ a, /** @type {ChatMessage} */ b) =>
  b.time - a.time || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
/** Oldest first, for a conversation read top to bottom. */
export const oldestFirst = (/** @type {ChatMessage} */ a, /** @type {ChatMessage} */ b) =>
  newestFirst(b, a);

/**
 * Merge items into messages by key: replaced when seen, chat items only, newest first.
 * @param {ChatMessage[]} shown
 * @param {MessageItem[]} items
 */
export function merged(shown, items) {
  const byKey = new Map(shown.map((m) => [m.key, m]));
  for (const item of items)
    if (isChat(item)) byKey.set(messageKey(item.source, item.id), chatOf(item));
  return [...byKey.values()].sort(newestFirst);
}

/**
 * The conversations a set of messages makes: one per source and channel, its name, kind and topic
 * from its newest message that says them, the unread and mention counts from the unread ones.
 * @param {ChatMessage[]} recent newest first
 * @param {ChatMessage[]} unread the unread messages, any order
 * @returns {Conversation[]} newest activity first
 */
export function conversationsOf(recent, unread) {
  /** @type {Map<string, Conversation>} */
  const found = new Map();
  const add = (/** @type {ChatMessage} */ m) => {
    const held = found.get(m.conversation);
    if (!held) {
      found.set(m.conversation, {
        key: m.conversation,
        source: m.source,
        channel: m.channel,
        name: m.channelName,
        kind: m.channelKind,
        platform: m.platform,
        workspace: m.workspace,
        ...(m.topic ? { topic: m.topic } : {}),
        latest: m,
        unread: 0,
        mentions: 0,
        at: m.time,
      });
      return;
    }
    if (m.time > held.at) {
      held.latest = m;
      held.at = m.time;
      held.name = m.channelName;
      held.kind = m.channelKind;
      if (m.topic) held.topic = m.topic;
    } else if (!held.topic && m.topic) held.topic = m.topic;
  };
  for (const m of [...recent].sort(newestFirst)) add(m);
  const seen = new Set();
  for (const m of unread) {
    if (!m.unread || seen.has(m.key)) continue;
    seen.add(m.key);
    add(m);
    const held = /** @type {Conversation} */ (found.get(m.conversation));
    held.unread += 1;
    if (m.mentioned || isDirect(m)) held.mentions += 1;
  }
  return [...found.values()].sort(
    (a, b) => b.at - a.at || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
}

/**
 * Where a key moves within a list of ids: the next or previous one, the first or the last.
 * @param {string[]} ids
 * @param {string | null} at
 * @param {string} key
 * @returns {string | undefined} the id to select, or nothing when the key is not the list's
 */
export function move(ids, at, key) {
  if (ids.length === 0) return undefined;
  const i = at === null ? -1 : ids.indexOf(at);
  switch (key) {
    case "ArrowDown":
    case "j":
    case "]":
      return i < 0 ? ids[0] : (ids[i + 1] ?? ids[i]);
    case "ArrowUp":
    case "k":
    case "[":
      return i < 0 ? ids[ids.length - 1] : (ids[i - 1] ?? ids[i]);
    case "Home":
      return ids[0];
    case "End":
      return ids[ids.length - 1];
    default:
      return undefined;
  }
}
