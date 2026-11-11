// From the state to what the view draws: the chrome (layouts, filters, services with their counts),
// the navigation's groups of conversations, the main area of the layout in use, the thread, and
// each message as the view shows it (its text parsed once, its avatar, actions and reactions).
// Pure functions over state.js.
import { emojiOf, reactionLabel } from "./emoji.js";
import { anyOf, badge, clockTime, countsLabel, fullTime, initials, sizeText } from "./format.js";
import { parse } from "./markup.js";
import { isDirect } from "./model.js";
import { detectPlatform, hueOf } from "./platforms.js";
import { FILTERS, filterOf, LAYOUTS, listed } from "./query.js";
import { conversationTarget, NO_CONNECTOR, threadTarget } from "./state.js";
import { cardsOf, columnsOf, entriesOf, mainline, replyCounts, streamOf } from "./timeline.js";

/**
 * @typedef {import("./state.js").State} State
 * @typedef {import("./state.js").Stream} Stream
 * @typedef {import("./model.js").ChatMessage} ChatMessage
 * @typedef {import("./model.js").Conversation} Conversation
 * @typedef {import("./platforms.js").Platform} Platform
 * @typedef {import("./markup.js").Block} Block
 * @typedef {import("./timeline.js").Entry} Entry
 * @typedef {import("./format.js").Clock} Clock
 * @typedef {{ emoji: string, count: number, self: boolean, label: string }} ReactionModel
 * @typedef {{
 *   key: string, author: string, initials: string, hue: number, time: string, at: string,
 *   full: string, blocks: Block[], self: boolean, bot: boolean, edited: boolean, pinned: boolean,
 *   mentioned: boolean, unread: boolean, saved: boolean, selected: boolean, editing: boolean,
 *   reactions: ReactionModel[], attachments: Array<{ name: string, size: string, url?: string }>,
 *   replies: number, continued: boolean, pending?: string, error?: string, deepLink?: string,
 *   platform: Platform, where: string, conversation: string,
 *   can: { react: boolean, reply: boolean, edit: boolean, delete: boolean },
 * }} MessageModel
 * @typedef {{ type: "day", key: string, label: string } | { type: "new", key: string }
 *   | { type: "message", key: string, message: MessageModel }} Row
 * @typedef {{ target: string, text: string, rev: number, placeholder: string, editing: boolean,
 *   disabled: string, enterSends: boolean }} ComposerModel
 * `disabled` is why the composer cannot send, or "".
 * @typedef {{ key: string, name: string, kind: string, platform: Platform, workspace: string,
 *   unread: number, mentions: number, label: string, active: boolean, pinned: boolean,
 *   preview: string, time: string }} ConversationRow
 * @typedef {{ id: string, title: string, platform?: Platform, rows: ConversationRow[] }} Group
 * @typedef {{ layout: string, layouts: typeof LAYOUTS, filter: string,
 *   filters: Array<{ id: string, title: string, count: string }>,
 *   platforms: Array<Platform & { unread: number, label: string }>, platform: string | null,
 *   search: string, density: string, connected: boolean, quick: string[] }} Chrome
 * @typedef {{ key: string, name: string, kind: string, platform: Platform, workspace: string,
 *   topic: string, rows: Row[], more: boolean, loading: boolean, composer: ComposerModel,
 *   pinned: boolean, unread: number, empty: string }} Pane
 * @typedef {({ layout: "conversation", pane: Pane | null }
 *   | { layout: "inbox", cards: Pane[] }
 *   | { layout: "timeline", title: string, rows: Row[], more: boolean, loading: boolean }
 *   | { layout: "columns", columns: Pane[] }) & { empty: string, connect: boolean }} Main
 * `connect` offers to connect an account: none is, and an installed connector brings messages.
 * @typedef {{ root: MessageModel, rows: Row[], loading: boolean, composer: ComposerModel, where: string }} ThreadModel
 */

/** @type {WeakMap<ChatMessage, Block[]>} */
const parsed = new WeakMap();
const blocksOf = (/** @type {ChatMessage} */ m) => {
  const held = parsed.get(m);
  if (held) return held;
  const blocks = parse(m.text, m.platform.id === "slack" ? "slack" : "markdown");
  parsed.set(m, blocks);
  return blocks;
};

/** With no account connected: the installed message connectors to connect, or that none exists. */
const noAccount = (/** @type {State} */ s) =>
  s.installed.length
    ? `No chat account is connected yet. Connect ${anyOf(s.installed)} and your conversations show here.`
    : NO_CONNECTOR;
const can = (
  /** @type {State} */ s,
  /** @type {string} */ connector,
  /** @type {import("./state.js").Action} */ a,
) => s.available.get(connector)?.has(a) ?? false;

/** Where a message was written: "Slack · Acme › #general", "Discord · DM with Rex". */
export function whereOf(
  /** @type {{ platform: Platform, workspace: string, channelName: string, channelKind: string }} */ m,
) {
  const name =
    m.channelKind === "dm"
      ? m.channelName
      : m.channelKind === "group"
        ? m.channelName
        : `#${m.channelName}`;
  return `${m.platform.name} · ${m.workspace} › ${name}`;
}

/**
 * One message as the view draws it.
 * @param {State} s
 * @param {ChatMessage} m
 * @param {{ continued?: boolean, replies?: number, pending?: string, error?: string, clock?: Clock }} [o]
 * @returns {MessageModel}
 */
export function messageModel(s, m, o = {}) {
  const pending = o.pending !== undefined;
  const connector = m.source.connector;
  return {
    key: m.key,
    author: m.author,
    initials: initials(m.author),
    hue: hueOf(m.authorKey),
    time: clockTime(m.at, o.clock),
    at: m.at,
    full: fullTime(m.at, o.clock),
    blocks: blocksOf(m),
    self: m.self,
    bot: m.bot,
    edited: m.editedAt !== undefined,
    pinned: m.pinned,
    mentioned: m.mentioned,
    unread: m.unread,
    saved: s.saved.includes(m.key),
    selected: s.selected === m.key,
    editing: s.editing?.key === m.key,
    reactions: m.reactions.map((r) => ({
      emoji: emojiOf(r.emoji),
      count: r.count,
      self: r.self,
      label: reactionLabel(r),
    })),
    attachments: m.attachments.map((a) => ({
      name: a.name,
      size: sizeText(a.size),
      ...(a.url ? { url: a.url } : {}),
    })),
    replies: o.replies ?? m.replyCount,
    continued: o.continued ?? false,
    ...(o.pending ? { pending: o.pending } : {}),
    ...(o.error ? { error: o.error } : {}),
    ...(m.deepLink ? { deepLink: m.deepLink } : {}),
    platform: m.platform,
    where: whereOf(m),
    conversation: m.conversation,
    can: {
      react: !pending && can(s, connector, "react"),
      reply: !pending && !m.isReply && can(s, connector, "send"),
      edit: !pending && m.self && can(s, connector, "edit"),
      delete: !pending && m.self && can(s, connector, "delete"),
    },
  };
}

/** @param {State} s @param {Entry[]} entries @param {Clock} [clock] @returns {Row[]} */
const rowsOf = (s, entries, clock) =>
  entries.map((e) =>
    e.type === "message"
      ? {
          type: "message",
          key: e.key,
          message: messageModel(s, e.message, {
            continued: e.continued,
            replies: e.replies,
            ...(e.pending ? { pending: e.pending } : {}),
            ...(e.error ? { error: e.error } : {}),
            ...(clock ? { clock } : {}),
          }),
        }
      : e,
  );

/** A composer for a target: its draft, whether the person is editing, why it cannot send. */
function composerOf(
  /** @type {State} */ s,
  /** @type {string} */ target,
  /** @type {string} */ connector,
  /** @type {string} */ placeholder,
) {
  const sends = can(s, connector, "send");
  return {
    target,
    text: s.drafts[target] ?? "",
    rev: s.revs[target] ?? 0,
    placeholder,
    editing: s.editing?.target === target,
    disabled: sends ? "" : `${connector} cannot send messages.`,
    enterSends: s.conf.enterSends,
  };
}

const pendingFor = (/** @type {State} */ s, /** @type {string} */ target) =>
  s.sending
    .filter((p) => p.target === target)
    .map((p) => ({ message: p.message, state: p.state, ...(p.error ? { error: p.error } : {}) }));

/** A conversation as one pane: the open one, an Inbox card or a Column. */
function paneOf(
  /** @type {State} */ s,
  /** @type {Conversation} */ c,
  /** @type {Stream | undefined} */ stream,
  /** @type {ChatMessage[] | undefined} */ only,
  /** @type {Clock | undefined} */ clock,
) {
  const target = conversationTarget(c.key);
  const messages = only ?? mainline(stream?.messages ?? []);
  const entries = entriesOf(messages, {
    firstUnread: only ? null : (stream?.firstUnread ?? null),
    pending: pendingFor(s, target),
    counts: replyCounts(stream?.messages ?? []),
    ...(clock ? { clock } : {}),
  });
  const name = c.kind === "dm" || c.kind === "group" ? c.name : `#${c.name}`;
  return {
    key: c.key,
    name: c.name,
    kind: c.kind,
    platform: c.platform,
    workspace: c.workspace,
    topic: c.topic ?? "",
    rows: rowsOf(s, entries, clock),
    more: !only && stream?.cursor !== undefined,
    loading: stream?.loading ?? false,
    composer: composerOf(s, target, c.source.connector, `Message ${name}`),
    pinned: s.pinned.includes(c.key),
    unread: c.unread,
    empty: stream?.loading ? "Loading…" : `No messages in ${name} yet.`,
  };
}

/** The conversations the navigation lists, by service and filter. @param {State} s */
export const visible = (s) =>
  s.conversations.filter(
    (c) =>
      (s.platform === null || c.platform.id === s.platform) &&
      listed(c, s.filter === "saved" ? "all" : s.filter),
  );

/** The navigation: each workspace's channels, then every service's direct messages together. */
export function sidebarOf(/** @type {State} */ s, /** @type {Clock} */ clock = {}) {
  /** @type {Map<string, Group>} */
  const groups = new Map();
  /** @type {Group} */
  const direct = { id: "direct", title: "Direct messages", rows: [] };
  for (const c of visible(s)) {
    const row = {
      key: c.key,
      name: c.name,
      kind: c.kind,
      platform: c.platform,
      workspace: c.workspace,
      unread: c.unread,
      mentions: c.mentions,
      label: countsLabel(c.unread, c.mentions),
      active: s.current === c.key,
      pinned: s.pinned.includes(c.key),
      preview: `${c.latest.self ? "You" : c.latest.author}: ${c.latest.text.split("\n")[0] ?? ""}`,
      time: clockTime(c.latest.at, clock),
    };
    if (c.kind === "dm" || c.kind === "group") {
      direct.rows.push(row);
      continue;
    }
    const id = `${c.source.connector}/${c.source.instance}|${c.workspace}`;
    const group = groups.get(id) ?? { id, title: c.workspace, platform: c.platform, rows: [] };
    group.rows.push(row);
    groups.set(id, group);
  }
  for (const group of groups.values()) group.rows.sort((a, b) => a.name.localeCompare(b.name));
  return {
    groups: [...groups.values(), ...(direct.rows.length ? [direct] : [])],
    current: s.current,
  };
}

/** The chrome: layouts, filters with their counts, the services with theirs. @param {State} s */
export function chromeOf(s) {
  const unread = [...s.unread.values()].filter((m) => !m.self);
  const count = (/** @type {(m: ChatMessage) => boolean} */ f) => unread.filter(f).length;
  const counts = {
    all: 0,
    unread: unread.length,
    mentions: count((m) => m.mentioned),
    direct: count((m) => isDirect(m)),
    saved: s.saved.length,
  };
  const seen = new Map(s.conversations.map((c) => [c.platform.id, c.platform]));
  for (const account of s.accounts) {
    const platform = detectPlatform(undefined, account.slice(0, account.indexOf("/")));
    if (platform.id !== "chat" && !seen.has(platform.id)) seen.set(platform.id, platform);
  }
  const platforms = [...seen.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => {
      const n = count((m) => m.platform.id === p.id);
      return { ...p, unread: n, label: n ? `${p.name}, ${n} unread` : p.name };
    });
  return {
    layout: s.layout,
    layouts: LAYOUTS,
    filter: s.filter,
    filters: FILTERS.map((f) => ({
      id: f.id,
      title: f.title,
      count: counts[f.id] ? badge(counts[f.id]) : "",
    })),
    platforms,
    platform: s.platform,
    search: s.search,
    density: s.conf.density,
    connected: s.accounts.length > 0 || s.conversations.length > 0,
    quick: s.conf.quick,
  };
}

/** The main area of the layout in use. @param {State} s @param {Clock} [clock] @returns {Main} */
export function mainOf(s, clock = {}) {
  const connected = s.accounts.length > 0 || s.conversations.length > 0;
  const connect = !connected && s.installed.length > 0;
  if (s.layout === "inbox") {
    const shown = new Set(visible(s).map((c) => c.key));
    const cards = cardsOf([...s.unread.values()], s.byKey)
      .filter((card) => shown.has(card.conversation.key))
      .map((card) => paneOf(s, card.conversation, undefined, card.messages, clock));
    const empty = connected ? "You are all caught up." : noAccount(s);
    return { layout: "inbox", cards, empty, connect };
  }
  if (s.layout === "timeline") {
    const filter = filterOf(s.filter)?.title ?? "All";
    const title = s.search ? `Results for "${s.search}"` : filter === "All" ? "Everything" : filter;
    const rows = rowsOf(s, streamOf(s.timeline.messages, clock), clock);
    const empty = !connected
      ? noAccount(s)
      : s.timeline.loading
        ? "Loading…"
        : s.search
          ? `Nothing matches "${s.search}".`
          : s.filter === "saved"
            ? "Nothing saved yet. Press s on a message to save it."
            : "Nothing here.";
    return {
      layout: "timeline",
      title,
      rows,
      more: s.timeline.cursor !== undefined,
      loading: s.timeline.loading,
      empty,
      connect,
    };
  }
  if (s.layout === "columns") {
    const shown = columnsOf(s.pinned, visible(s));
    const columns = shown.map((c) => paneOf(s, c, s.columns.get(c.key), undefined, clock));
    return {
      layout: "columns",
      columns,
      empty: connected ? "No conversations yet." : noAccount(s),
      connect,
    };
  }
  const c = s.current ? s.byKey.get(s.current) : undefined;
  const pane = c ? paneOf(s, c, s.open ?? undefined, undefined, clock) : null;
  const empty = !connected
    ? noAccount(s)
    : s.conversations.length === 0
      ? "No conversations yet."
      : "Pick a conversation.";
  return { layout: "conversation", pane, empty, connect };
}

/** The thread beside the conversation. @param {State} s @param {Clock} [clock] @returns {ThreadModel | null} */
export function threadOf(s, clock = {}) {
  const t = s.thread;
  if (!t) return null;
  const target = threadTarget(t.root.key);
  const entries = entriesOf(t.replies, {
    pending: pendingFor(s, target),
    ...(clock ? { clock } : {}),
  });
  return {
    root: messageModel(s, t.root, { replies: t.replies.length, clock }),
    rows: rowsOf(s, entries, clock),
    loading: t.loading,
    composer: composerOf(s, target, t.root.source.connector, "Reply in thread"),
    where: whereOf(t.root),
  };
}
