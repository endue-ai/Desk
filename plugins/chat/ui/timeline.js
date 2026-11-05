// How messages line up on screen: a conversation read top to bottom with its day headings, the
// "New" line above the first unread message and an author's run of messages within five minutes
// drawn as one; the Timeline's single stream of every conversation; the Inbox's cards of unread
// conversations; and the conversations the Columns layout shows. Pure functions over model.js.
import { dayLabel, dayOf, localZone } from "./format.js";
import { isDirect, newestFirst, oldestFirst } from "./model.js";

/**
 * @typedef {import("./model.js").ChatMessage} ChatMessage
 * @typedef {import("./model.js").Conversation} Conversation
 * @typedef {import("./format.js").Clock} Clock
 * @typedef {"sending" | "failed"} PendingState
 * @typedef {{ type: "day", key: string, label: string }
 *   | { type: "new", key: string }
 *   | { type: "message", key: string, message: ChatMessage, continued: boolean, replies: number,
 *       pending?: PendingState, error?: string }} Entry
 * @typedef {{ message: ChatMessage, state: PendingState, error?: string }} Pending
 * @typedef {{ conversation: Conversation, messages: ChatMessage[], unread: number, mentions: number }} Card
 */

/** Messages by one author closer than this read as one run. */
export const RUN_MS = 5 * 60_000;
/** The most columns the Columns layout shows, and how many it picks when none is pinned. */
export const MAX_COLUMNS = 6;
export const DEFAULT_COLUMNS = 3;
/** How many unread messages an Inbox card shows. */
export const CARD_MESSAGES = 3;

/** The messages a conversation's main stream shows: roots and broadcast replies, not the rest. */
export const mainline = (/** @type {ChatMessage[]} */ messages) =>
  messages.filter((m) => !m.isReply || m.broadcast);

/** How many replies of each root the messages hold, by the root's id. */
export function replyCounts(/** @type {ChatMessage[]} */ messages) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const m of messages)
    if (m.isReply && m.thread) counts.set(m.thread, (counts.get(m.thread) ?? 0) + 1);
  return counts;
}

/**
 * A conversation's entries, oldest first: day headings, the New line before `firstUnread`, and
 * each message marked `continued` when it follows the same author's within RUN_MS on the same day.
 * @param {ChatMessage[]} messages any order
 * @param {{ firstUnread?: string | null, clock?: Clock, pending?: Pending[], counts?: Map<string, number> }} [options]
 * @returns {Entry[]}
 */
export function entriesOf(messages, options = {}) {
  const clock = options.clock ?? {};
  const zone = clock.zone ?? localZone();
  const counts = options.counts ?? replyCounts(messages);
  /** @type {Array<{ message: ChatMessage, pending?: Pending }>} */
  const rows = [...messages].sort(oldestFirst).map((message) => ({ message }));
  for (const pending of options.pending ?? []) rows.push({ message: pending.message, pending });
  /** @type {Entry[]} */
  const out = [];
  /** @type {ChatMessage | undefined} */
  let previous;
  let day = "";
  for (const { message, pending } of rows) {
    const today = dayOf(message.time, zone);
    if (today !== day) {
      day = today;
      out.push({ type: "day", key: `day:${today}`, label: dayLabel(message.time, clock) });
      previous = undefined;
    }
    if (options.firstUnread && message.key === options.firstUnread) {
      out.push({ type: "new", key: "new" });
      previous = undefined;
    }
    const continued =
      previous !== undefined &&
      previous.authorKey === message.authorKey &&
      previous.bot === message.bot &&
      message.time - previous.time <= RUN_MS;
    out.push({
      type: "message",
      key: message.key,
      message,
      continued,
      replies: Math.max(message.replyCount, counts.get(message.id) ?? 0),
      ...(pending ? { pending: pending.state } : {}),
      ...(pending?.error ? { error: pending.error } : {}),
    });
    previous = message;
  }
  return out;
}

/**
 * The first unread message of a conversation's main stream, which the New line sits above.
 * @param {ChatMessage[]} messages any order
 */
export function firstUnread(messages) {
  const unread = mainline(messages)
    .filter((m) => m.unread && !m.self)
    .sort(oldestFirst);
  return unread[0]?.key ?? null;
}

/**
 * The Timeline's entries: every message newest first under a heading per day, nothing grouped,
 * since neighbours come from different conversations.
 * @param {ChatMessage[]} messages
 * @param {Clock} [clock]
 * @returns {Entry[]}
 */
export function streamOf(messages, clock = {}) {
  const zone = clock.zone ?? localZone();
  /** @type {Entry[]} */
  const out = [];
  let day = "";
  for (const message of [...messages].sort(newestFirst)) {
    const today = dayOf(message.time, zone);
    if (today !== day) {
      day = today;
      out.push({ type: "day", key: `day:${today}`, label: dayLabel(message.time, clock) });
    }
    out.push({
      type: "message",
      key: message.key,
      message,
      continued: false,
      replies: message.replyCount,
    });
  }
  return out;
}

/**
 * The Inbox's cards: one per conversation with unread messages, the ones that call the person
 * (mentions and direct messages) first, then the newest; each with its last few unread messages.
 * @param {ChatMessage[]} unread
 * @param {Map<string, Conversation>} conversations by key
 * @returns {Card[]}
 */
export function cardsOf(unread, conversations) {
  /** @type {Map<string, ChatMessage[]>} */
  const by = new Map();
  for (const m of unread) {
    if (!m.unread || m.self) continue;
    const list = by.get(m.conversation) ?? [];
    if (!list.some((x) => x.key === m.key)) list.push(m);
    by.set(m.conversation, list);
  }
  /** @type {Card[]} */
  const cards = [];
  for (const [key, list] of by) {
    const conversation = conversations.get(key);
    if (!conversation) continue;
    const sorted = [...list].sort(oldestFirst);
    cards.push({
      conversation,
      messages: sorted.slice(-CARD_MESSAGES),
      unread: sorted.length,
      mentions: sorted.filter((m) => m.mentioned || isDirect(m)).length,
    });
  }
  const latest = (/** @type {Card} */ c) => c.messages.at(-1)?.time ?? 0;
  return cards.sort(
    (a, b) =>
      Number(b.mentions > 0) - Number(a.mentions > 0) ||
      latest(b) - latest(a) ||
      (a.conversation.key < b.conversation.key ? -1 : 1),
  );
}

/**
 * The conversations the Columns layout shows: the pinned ones that exist, in pin order, else the
 * newest few.
 * @param {string[]} pinned conversation keys
 * @param {Conversation[]} conversations newest first
 */
export function columnsOf(pinned, conversations) {
  const byKey = new Map(conversations.map((c) => [c.key, c]));
  const chosen = pinned.flatMap((key) => {
    const c = byKey.get(key);
    return c ? [c] : [];
  });
  if (chosen.length > 0) return chosen.slice(0, MAX_COLUMNS);
  return conversations.slice(0, DEFAULT_COLUMNS);
}
