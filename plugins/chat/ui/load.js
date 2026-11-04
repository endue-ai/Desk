// Reading what the screen needs from the index: the recent and unread messages the navigation
// and counts come from, one conversation a page at a time, a thread, the Timeline under its filter
// and search, the Columns' conversations and the saved messages. Each read fills state.js and
// redraws; a failure is said on the status line and leaves what was shown.
import { chatOf, conversationRef, conversationsOf, isChat, merged } from "./model.js";
import { detectPlatform } from "./platforms.js";
import {
  conversationQuery,
  recentQuery,
  says,
  threadQuery,
  timelineQuery,
  unreadQuery,
} from "./query.js";
import { SAVED_MAX } from "./state.js";
import { columnsOf, firstUnread } from "./timeline.js";

/**
 * @typedef {import("@endue-ai/bridge").MessageItem} MessageItem
 * @typedef {import("@endue-ai/bridge").Item} Item
 * @typedef {import("./state.js").State} State
 * @typedef {import("./model.js").ChatMessage} ChatMessage
 * @typedef {{
 *   state: State,
 *   actions: ReturnType<typeof import("./actions.js").createActions>,
 *   say(text: string): void,
 *   render(): void,
 * }} Deps
 */

/** The page a Column reads of its conversation. */
export const COLUMN_PAGE = 40;

const chats = (/** @type {Item[]} */ items) =>
  /** @type {MessageItem[]} */ (items.filter((i) => isChat(i))).map((i) => chatOf(i));
const why = (/** @type {unknown} */ error) =>
  error instanceof Error ? error.message : String(error);

/** @param {Deps} deps */
export function createLoad({ state: s, actions, say, render }) {
  /** The conversations again, from the recent and unread messages held. */
  const recount = () => {
    s.conversations = conversationsOf([...s.recent.values()], [...s.unread.values()]);
    s.byKey = new Map(s.conversations.map((c) => [c.key, c]));
  };

  /** Whether a message is of the service the person picked, or any when none is. */
  const ofPlatform = (/** @type {ChatMessage} */ m) =>
    s.platform === null || m.platform.id === s.platform;

  /**
   * The accounts of the picked service: those whose connector id names it or whose messages say
   * it. Undefined when every account counts; empty when none is of the service.
   */
  const sources = () => {
    if (s.platform === null) return undefined;
    const by = new Set(
      [...s.recent.values()]
        .filter(ofPlatform)
        .map((m) => `${m.source.connector}/${m.source.instance}`),
    );
    for (const account of s.accounts) {
      const connector = account.slice(0, account.indexOf("/"));
      if (detectPlatform(undefined, connector).id === s.platform) by.add(account);
    }
    return [...by].sort();
  };

  /** The navigation's messages: the newest of every account and the unread ones. */
  const lists = async () => {
    try {
      const [recent, unread] = await Promise.all([
        actions.query(recentQuery(undefined)),
        actions.query(unreadQuery(undefined)),
      ]);
      s.recent = new Map(chats(recent.items).map((m) => [m.key, m]));
      s.unread = new Map(chats(unread.items).map((m) => [m.key, m]));
      recount();
      say("");
      return true;
    } catch (error) {
      say(why(error));
      return false;
    } finally {
      render();
    }
  };

  /** Where a conversation key points: the one listed, or the key read back. */
  const refOf = (/** @type {string} */ key) => {
    const listed = s.byKey.get(key);
    if (listed) return { source: listed.source, channel: listed.channel };
    return conversationRef(key);
  };

  /**
   * One conversation's newest page; `more` adds the page before it. The New line sits above the
   * first unread message as it was when the conversation opened.
   */
  const conversation = async (/** @type {string} */ key, more = false) => {
    const ref = refOf(key);
    if (!ref) throw new Error(`${key} is not a conversation.`);
    const held = s.open;
    if (more && !held?.cursor) return;
    s.open = {
      messages: more ? (held?.messages ?? []) : [],
      loading: true,
      firstUnread: held?.firstUnread ?? null,
      ...(more && held?.cursor ? { cursor: held.cursor } : {}),
    };
    render();
    try {
      const page = await actions.query(
        conversationQuery(ref, s.conf.page, more ? held?.cursor : undefined),
      );
      if (s.current !== key) return;
      const messages = merged(
        more ? (held?.messages ?? []) : [],
        /** @type {MessageItem[]} */ (page.items),
      );
      s.open = {
        messages,
        loading: false,
        firstUnread: more ? (held?.firstUnread ?? null) : firstUnread(messages),
        ...(page.cursor ? { cursor: page.cursor } : {}),
      };
      say("");
    } catch (error) {
      if (s.open) s.open.loading = false;
      say(why(error));
    } finally {
      render();
    }
  };

  /** A thread: its root and every reply, oldest first, with the ones the conversation holds. */
  const thread = async (/** @type {ChatMessage} */ root) => {
    const local = (s.open?.messages ?? []).filter(
      (m) => m.isReply && m.thread === root.id && m.conversation === root.conversation,
    );
    s.thread = { root, replies: local, loading: true };
    render();
    try {
      const page = await actions.query(threadQuery(root));
      if (s.thread?.root.key !== root.key) return;
      const replies = merged(local, /** @type {MessageItem[]} */ (page.items)).filter(
        (m) => m.key !== root.key,
      );
      s.thread = { root, replies, loading: false };
      say("");
    } catch (error) {
      if (s.thread) s.thread.loading = false;
      say(why(error));
    } finally {
      render();
    }
  };

  /** The saved messages that are still in the index, newest first. */
  const saved = async () => {
    const found = await Promise.all(
      s.saved.slice(0, SAVED_MAX).map(async (key) => {
        const hash = key.indexOf("#");
        const [connector = "", instance = ""] = key.slice(0, hash).split("/");
        const item = await actions
          .get({ connector, instance }, key.slice(hash + 1))
          .catch(() => undefined);
        return item && isChat(item) ? [chatOf(/** @type {MessageItem} */ (item))] : [];
      }),
    );
    return found.flat();
  };

  /** The Timeline: every account's messages, or the picked service's, under a filter and a search. */
  const timeline = async (more = false) => {
    const held = s.timeline;
    if (more && !held.cursor) return;
    s.timeline = { ...held, loading: true };
    render();
    try {
      /** @type {ChatMessage[]} */
      let messages;
      /** @type {string | undefined} */
      let cursor;
      const accounts = sources();
      if (s.filter === "saved") {
        messages = (await saved()).filter((m) => !s.search || says(m, s.search));
      } else if (accounts?.length === 0) {
        messages = [];
      } else {
        const page = await actions.query(
          timelineQuery({
            filter: s.filter,
            text: s.search || undefined,
            sources: accounts,
            page: s.conf.page,
            ...(more ? { cursor: held.cursor } : {}),
          }),
        );
        messages = merged(more ? held.messages : [], /** @type {MessageItem[]} */ (page.items));
        cursor = page.cursor;
      }
      s.timeline = {
        messages: messages.filter(ofPlatform),
        loading: false,
        firstUnread: null,
        ...(cursor ? { cursor } : {}),
      };
      say("");
    } catch (error) {
      s.timeline = { ...s.timeline, loading: false };
      say(why(error));
    } finally {
      render();
    }
  };

  /** The Columns' conversations: each read once, then kept live by sync.js. */
  const columns = async (again = false) => {
    const shown = columnsOf(
      s.pinned,
      s.conversations.filter((c) => s.platform === null || c.platform.id === s.platform),
    );
    for (const key of [...s.columns.keys()])
      if (!shown.some((c) => c.key === key)) s.columns.delete(key);
    const wanted = shown.filter((c) => again || !s.columns.has(c.key));
    for (const c of wanted)
      s.columns.set(c.key, {
        messages: s.columns.get(c.key)?.messages ?? [],
        loading: true,
        firstUnread: null,
      });
    if (wanted.length === 0) return render();
    render();
    await Promise.all(
      wanted.map(async (c) => {
        try {
          const page = await actions.query(
            conversationQuery({ source: c.source, channel: c.channel }, COLUMN_PAGE),
          );
          const messages = merged([], /** @type {MessageItem[]} */ (page.items));
          s.columns.set(c.key, { messages, loading: false, firstUnread: firstUnread(messages) });
        } catch (error) {
          s.columns.set(c.key, { messages: [], loading: false, firstUnread: null });
          say(why(error));
        }
      }),
    );
    render();
  };

  /** What the layout on screen needs beyond the navigation. */
  const layout = async () => {
    if (s.layout === "timeline") await timeline();
    else if (s.layout === "columns") await columns();
    else if (s.layout === "conversation" && s.current && !s.open) await conversation(s.current);
    else render();
  };

  return {
    recount,
    lists,
    conversation,
    thread,
    timeline,
    columns,
    layout,
    refOf,
    ofPlatform,
    sources,
  };
}
