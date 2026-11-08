// Keeping the screen and the index in step: a change a connector reports (data.changed) joins,
// updates or leaves every place it shows (the navigation, the open conversation, its thread, the
// Timeline, the Columns, a message being sent), and a change the person makes shows at once, goes
// to the connector's command, and is undone when the connector refuses. New direct messages and
// mentions are announced as the `notify` setting says.
import { chatOf, isChat, isDirect, merged, messageKey } from "./model.js";
import { CHAT, passes, says } from "./query.js";

/**
 * @typedef {import("@endue-ai/bridge").BridgeEvent} BridgeEvent
 * @typedef {import("@endue-ai/bridge").MessageItem} MessageItem
 * @typedef {import("@endue-ai/bridge").ItemSource} ItemSource
 * @typedef {import("./state.js").State} State
 * @typedef {import("./state.js").Action} Action
 * @typedef {import("./state.js").Stream} Stream
 * @typedef {import("./model.js").ChatMessage} ChatMessage
 * @typedef {{
 *   state: State,
 *   actions: ReturnType<typeof import("./actions.js").createActions>,
 *   load: ReturnType<typeof import("./load.js").createLoad>,
 *   bridge: { onEvent(listener: (event: BridgeEvent) => void): unknown },
 *   say(text: string): void,
 *   render(): void,
 * }} Deps
 */

/** A message announced only when it arrived this long before the plugin started, or later. */
const RECENT_MS = 60_000;

const without = (/** @type {ChatMessage[]} */ list, /** @type {string} */ key) =>
  list.filter((m) => m.key !== key);
/** The stream with the message in it (replaced when there), or without it when `keep` is false. */
const into = (/** @type {Stream} */ stream, /** @type {ChatMessage} */ m, keep = true) => ({
  ...stream,
  messages: keep ? merged(stream.messages, [m.item]) : without(stream.messages, m.key),
});

/** @param {Deps} deps */
export function createSync({ state: s, actions, load, bridge, say, render }) {
  /** Whether the Timeline as the person sees it now shows a message. */
  const inTimeline = (/** @type {ChatMessage} */ m) =>
    passes(m, s.filter, new Set(s.saved)) && load.ofPlatform(m) && (!s.search || says(m, s.search));

  /** The messages being sent that this one, now in the index, stands for. */
  const settle = (/** @type {ChatMessage} */ m) => {
    const sent = s.sending.findIndex(
      (p) =>
        p.message.conversation === m.conversation &&
        (p.message.id === m.id ||
          (m.self &&
            p.state !== "failed" &&
            p.text.trim() === m.text.trim() &&
            (p.message.thread ?? "") === (m.thread ?? ""))),
    );
    if (sent >= 0) s.sending = s.sending.filter((_, i) => i !== sent);
  };

  /** One message changed: it joins, leaves or updates every place it shows. */
  const apply = (/** @type {MessageItem} */ item) => {
    if (!isChat(item)) return;
    const m = chatOf(item);
    s.recent.set(m.key, m);
    if (m.unread) s.unread.set(m.key, m);
    else s.unread.delete(m.key);
    if (s.open && s.current === m.conversation) s.open = into(s.open, m);
    const t = s.thread;
    if (t && m.key === t.root.key) s.thread = { ...t, root: m };
    else if (t && m.conversation === t.root.conversation && m.thread === t.root.id && m.isReply)
      s.thread = { ...t, replies: merged(t.replies, [item]) };
    const shown = s.timeline.messages.some((x) => x.key === m.key);
    if (shown || inTimeline(m)) s.timeline = into(s.timeline, m, inTimeline(m));
    const column = s.columns.get(m.conversation);
    if (column) s.columns.set(m.conversation, into(column, m));
    settle(m);
    load.recount();
  };

  /** A message left the index. */
  const dropped = (/** @type {ItemSource} */ source, /** @type {string} */ id) => {
    const key = messageKey(source, id);
    const held = s.recent.get(key);
    s.recent.delete(key);
    s.unread.delete(key);
    if (s.open) s.open = { ...s.open, messages: without(s.open.messages, key) };
    if (s.thread?.root.key === key) s.thread = null;
    else if (s.thread) s.thread = { ...s.thread, replies: without(s.thread.replies, key) };
    s.timeline = { ...s.timeline, messages: without(s.timeline.messages, key) };
    const column = held ? s.columns.get(held.conversation) : undefined;
    if (held && column)
      s.columns.set(held.conversation, { ...column, messages: without(column.messages, key) });
    if (s.selected === key) s.selected = null;
    load.recount();
  };

  /**
   * Run a connector action with the change already on screen; undo it when refused.
   * @param {ChatMessage[]} messages the messages before
   * @param {MessageItem[]} after the same messages after the change ([] when they go)
   * @param {Action} action
   * @param {Record<string, unknown>} args
   * @param {string} done the sentence for the status line when it went
   */
  const change = async (messages, after, action, args, done) => {
    const [first] = messages;
    if (!first) return;
    if (after.length === 0) for (const m of messages) dropped(m.source, m.id);
    for (const item of after) apply(item);
    render();
    try {
      const result = await actions.run(first.source.connector, action, {
        instance: first.source.instance,
        channel: first.channel,
        ...args,
      });
      say(done);
      return result;
    } catch (error) {
      for (const m of messages) apply(m.item);
      render();
      say(error instanceof Error ? error.message : String(error));
      throw error;
    }
  };

  /** Whether a new message should be announced, as the notify setting says. */
  const announces = (/** @type {ChatMessage} */ m) => {
    if (!m.unread || m.self || s.conf.notify === "none") return false;
    if (s.layout === "conversation" && s.current === m.conversation) return false;
    return s.conf.notify === "all" || m.mentioned || isDirect(m);
  };
  const announce = (/** @type {ChatMessage} */ m) => {
    const where = isDirect(m) ? m.channelName : `#${m.channelName}`;
    const title = isDirect(m) && m.channelKind === "dm" ? m.author : `${m.author} in ${where}`;
    void actions.notify(
      `${title} · ${m.platform.name}`,
      m.text.split("\n")[0]?.slice(0, 200) ?? "",
    );
  };

  return {
    apply,
    dropped,
    change,

    /** Follow the index: new messages arrive, read and edited ones change, deleted ones leave. */
    follow: async () => {
      bridge.onEvent((event) => {
        if (event.event !== "data.changed") return;
        for (const c of event.data.changes) {
          if (c.change === "removed") {
            dropped(c.source, c.id);
            continue;
          }
          if (!isChat(c.item)) continue;
          const m = chatOf(/** @type {MessageItem} */ (c.item));
          const fresh = !s.recent.has(m.key);
          apply(/** @type {MessageItem} */ (c.item));
          if (fresh && m.time >= s.startedAt - RECENT_MS && announces(m)) announce(m);
        }
        render();
      });
      await actions.subscribe({ kinds: ["message"], where: [CHAT] }).catch(() => undefined);
    },
  };
}
