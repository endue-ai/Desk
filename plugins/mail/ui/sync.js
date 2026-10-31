// Keeping the screen and the index in step: a change the connector reports (data.changed) joins,
// updates or leaves the list and the reader, and a change the person makes (read, flagged, moved)
// shows at once, goes to the connector's command, and is undone when the connector refuses.
import {
  inMailbox,
  MAILBOXES,
  mailboxOf,
  merged,
  messageOf,
  sourceKey,
  threadsOf,
} from "./model.js";

/**
 * @typedef {import("@endue-ai/bridge").BridgeEvent} BridgeEvent
 * @typedef {import("@endue-ai/bridge").MessageItem} MessageItem
 * @typedef {import("./state.js").State} State
 * @typedef {import("./model.js").Message} Message
 * @typedef {{
 *   state: State,
 *   actions: ReturnType<typeof import("./actions.js").createActions>,
 *   bridge: { onEvent(listener: (event: BridgeEvent) => void): unknown },
 *   say(text: string): void,
 *   changed(): void,
 * }} Deps
 * `changed` redraws the list and the reader and schedules a recount.
 */

/** @param {Deps} deps */
export function createSync({ state, actions, bridge, say, changed }) {
  const mailbox = () => mailboxOf(state.mailboxId) ?? MAILBOXES[0];

  /** One item changed: it joins, leaves or updates the list and the reader. */
  const apply = (/** @type {MessageItem} */ item) => {
    const message = messageOf(item);
    const filter = { text: state.search, account: state.account ?? undefined };
    const index = state.messages.findIndex((m) => m.key === message.key);
    if (inMailbox(item, mailbox(), filter)) state.messages = merged(state.messages, [item]);
    else if (index >= 0) state.messages = state.messages.filter((m) => m.key !== message.key);
    state.threads = threadsOf(state.messages);
    if (state.open?.key === message.key) state.open = message;
    state.earlier = state.earlier.map((m) => (m.key === message.key ? message : m));
    changed();
  };

  /** An item left the index. */
  const dropped = (/** @type {MessageItem["source"]} */ source, /** @type {string} */ id) => {
    const key = `${sourceKey(source)}#${id}`;
    const shown = state.messages.some((m) => m.key === key) || state.open?.key === key;
    if (!shown) return;
    state.messages = state.messages.filter((m) => m.key !== key);
    state.threads = threadsOf(state.messages);
    state.earlier = state.earlier.filter((m) => m.key !== key);
    if (state.open?.key === key) state.open = null;
    changed();
  };

  /**
   * Run a connector action on a message with the change already on screen; undo it when refused.
   * @param {Message} message
   * @param {MessageItem} after
   * @param {"flag" | "move"} action
   * @param {Record<string, unknown>} args
   * @param {string} done the sentence for the status line when it went
   */
  const change = async (message, after, action, args, done) => {
    const before = message.item;
    apply(after);
    try {
      await actions.run(message.source.connector, action, {
        instance: message.source.instance,
        id: message.id,
        ...args,
      });
      say(done);
    } catch (error) {
      apply(before);
      say(error instanceof Error ? error.message : String(error));
      throw error;
    }
  };

  return {
    apply,
    dropped,

    /** Mark a message read or unread, flagged or not. */
    setFlags: (
      /** @type {Message} */ message,
      /** @type {{ unread?: boolean, flagged?: boolean }} */ flags,
    ) => {
      const { item } = message;
      const raw = {
        ...(item.raw ?? {}),
        ...(flags.flagged === undefined ? {} : { flagged: flags.flagged }),
      };
      const after = {
        ...item,
        ...(flags.unread === undefined ? {} : { unread: flags.unread }),
        raw,
      };
      return change(message, after, "flag", flags, "");
    },

    /** Move a message to a mailbox role: archive, trash, inbox, junk. */
    moveTo: (/** @type {Message} */ message, /** @type {string} */ role) => {
      const { item } = message;
      const after = { ...item, raw: { ...(item.raw ?? {}), mailbox: role } };
      return change(message, after, "move", { mailbox: role }, `Moved to ${role}.`);
    },

    /** Follow the index: new mail arrives, read and moved mail changes, deleted mail leaves. */
    follow: async () => {
      const known = new Set(state.messages.map((m) => m.key));
      bridge.onEvent((event) => {
        if (event.event !== "data.changed") return;
        for (const c of event.data.changes) {
          if (c.change === "removed") {
            known.delete(`${sourceKey(c.source)}#${c.id}`);
            dropped(c.source, c.id);
            continue;
          }
          if (c.item.kind !== "message") continue;
          const message = messageOf(c.item);
          const fresh = !known.has(message.key);
          known.add(message.key);
          apply(c.item);
          const recent = Date.parse(message.receivedAt) >= state.startedAt - 60_000;
          if (fresh && recent && message.unread && message.mailbox === "inbox" && state.conf.notify)
            void actions.notify(
              message.from.name ?? message.from.email ?? "New mail",
              message.title,
            );
        }
      });
      await actions.subscribe({ kinds: ["message"] }).catch(() => undefined);
    },
  };
}
