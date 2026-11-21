// What an agent reads through the chat plugin (ADR 0088): the conversations with their unread
// counts, one conversation's or thread's messages, and messages found by words, each as data, from
// the desk's index, leaving the screen as it is. A conversation is named by `{ source, channel }` and
// a message by `{ source, id }`, as the answers carry them; send, react, edit and delete take the
// same names (commands.js), and send and delete are irreversible, so the desk asks the person first.
import { chatOf, conversationRef, isChat, oldestFirst } from "./model.js";
import { conversationQuery, threadQuery, timelineQuery } from "./query.js";
import { asString } from "./state.js";

/**
 * @typedef {import("@endue-ai/bridge").MessageItem} MessageItem
 * @typedef {import("@endue-ai/bridge").ItemQuery} ItemQuery
 * @typedef {import("./model.js").ChatMessage} ChatMessage
 * @typedef {import("./model.js").Conversation} Conversation
 */

/** How many messages one answer holds by default and at most, and how long a text may be. */
export const MESSAGES = { usual: 20, most: 100 };
export const TEXT_MAX = 4000;

const limitOf = (
  /** @type {unknown} */ value,
  /** @type {{ usual: number, most: number }} */ r,
) => {
  const asked = Number(value);
  return Number.isInteger(asked) && asked > 0 ? Math.min(asked, r.most) : r.usual;
};

/** A message as an agent reads it. */
export function messageAnswer(/** @type {ChatMessage} */ m) {
  return {
    source: m.source,
    id: m.id,
    channel: m.channel,
    author: m.author,
    self: m.self,
    at: m.at,
    text: m.text.length > TEXT_MAX ? `${m.text.slice(0, TEXT_MAX)}…` : m.text,
    unread: m.unread,
    ...(m.thread ? { thread: m.thread } : {}),
    isReply: m.isReply,
    replyCount: m.replyCount,
    reactions: m.reactions.map((r) => ({ emoji: r.emoji, count: r.count })),
    attachments: m.attachments.map((a) => a.name),
  };
}

/** A conversation as an agent reads it. */
export function conversationAnswer(/** @type {Conversation} */ c) {
  return {
    source: c.source,
    channel: c.channel,
    name: c.name,
    kind: c.kind,
    platform: c.platform.name,
    workspace: c.workspace,
    unread: c.unread,
    mentions: c.mentions,
    latest: { author: c.latest.author, at: c.latest.at, text: c.latest.text.slice(0, 200) },
  };
}

/**
 * @param {(name: string, handler: (a: Record<string, unknown>) => unknown) => void} answer
 * @param {{ conversations(): Conversation[],
 *   query(q: ItemQuery): Promise<{ items: unknown[] }>,
 *   message(key: string): Promise<ChatMessage> }} deps
 */
export function answerAgents(answer, deps) {
  const chats = async (/** @type {ItemQuery} */ query) =>
    (await deps.query(query)).items
      .filter((i) => isChat(/** @type {{ kind?: string, raw?: unknown }} */ (i)))
      .map((i) => chatOf(/** @type {MessageItem} */ (i)));

  /** The conversation `{ source, channel }` or `{ conversation }` names. */
  const named = (/** @type {Record<string, unknown>} */ a) => {
    const source = /** @type {{ connector?: unknown, instance?: unknown }} */ (a.source ?? {});
    const channel = asString(a.channel);
    if (channel && typeof source.connector === "string" && typeof source.instance === "string")
      return { source: { connector: source.connector, instance: source.instance }, channel };
    const ref = conversationRef(asString(a.conversation) ?? "");
    if (!ref)
      throw new Error("Name the conversation: { source, channel }, as conversations answers.");
    return ref;
  };

  answer("endue.chat.conversations", (a) => {
    const platform = asString(a.platform)?.toLowerCase();
    const words = (asString(a.query) ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const all = deps
      .conversations()
      .filter(
        (c) =>
          !platform || c.platform.id === platform || c.platform.name.toLowerCase() === platform,
      )
      .filter((c) => a.unread !== true || c.unread > 0)
      .filter((c) => {
        const text = `${c.name} ${c.workspace} ${c.platform.name}`.toLowerCase();
        return words.every((w) => text.includes(w));
      });
    const limit = limitOf(a.limit, { usual: 30, most: 200 });
    return {
      conversations: all.slice(0, limit).map(conversationAnswer),
      unread: all.reduce((n, c) => n + c.unread, 0),
      more: all.length > limit,
    };
  });

  answer("endue.chat.messages", async (a) => {
    const conversation = named(a);
    const limit = limitOf(a.limit, MESSAGES);
    const thread = asString(a.thread);
    if (thread) {
      const root = await deps.message(
        `${conversation.source.connector}/${conversation.source.instance}#${thread}`,
      );
      const replies = (await chats(threadQuery(root))).filter((m) => m.id !== root.id);
      return {
        ...conversation,
        thread,
        root: messageAnswer(root),
        messages: replies.slice(-limit).map(messageAnswer),
      };
    }
    const newest = await chats(conversationQuery(conversation, limit));
    return { ...conversation, messages: [...newest].sort(oldestFirst).map(messageAnswer) };
  });

  answer("endue.chat.find-messages", async (a) => {
    const text = asString(a.text)?.trim();
    if (!text) throw new Error("Say which words to find: text is empty.");
    const found = await chats(
      timelineQuery({ filter: "all", text, page: limitOf(a.limit, MESSAGES) }),
    );
    return { text, messages: found.map(messageAnswer) };
  });
}
