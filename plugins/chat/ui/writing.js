// What the person writes and does to messages: drafts per conversation and thread (kept in the
// store 300 ms after the last key), sending with the message on screen at once and Retry when it
// fails, editing and deleting their own messages, reactions, and marking conversations read. Every
// change runs the connector's command through sync.js, which undoes it when refused.
import { emojiOf, sameEmoji } from "./emoji.js";
import { chatOf, conversationRef, messageKey, messageRef } from "./model.js";
import { conversationTarget, threadTarget } from "./state.js";

/**
 * @typedef {import("@endue-ai/bridge").MessageItem} MessageItem
 * @typedef {import("./state.js").State} State
 * @typedef {import("./state.js").Action} Action
 * @typedef {import("./model.js").ChatMessage} ChatMessage
 * @typedef {{
 *   state: State,
 *   actions: ReturnType<typeof import("./actions.js").createActions>,
 *   sync: ReturnType<typeof import("./sync.js").createSync>,
 *   load: ReturnType<typeof import("./load.js").createLoad>,
 *   say(text: string): void,
 *   render(): void,
 *   store(key: string, value: unknown): void,
 *   now(): number,
 *   saveMs?: number,
 * }} Deps
 */

export const DRAFTS_KEY = "drafts";

/** @param {Deps} deps */
export function createWriting({
  state: s,
  actions,
  sync,
  load,
  say,
  render,
  store,
  now,
  saveMs = 300,
}) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let saving;
  let sent = 0;
  const can = (/** @type {string} */ connector, /** @type {Action} */ action) =>
    s.available.get(connector)?.has(action) ?? false;
  const iso = () => new Date(now()).toISOString();

  const saveDrafts = () => {
    clearTimeout(saving);
    saving = undefined;
    store(DRAFTS_KEY, s.drafts);
  };
  /** The plugin changes a draft itself: the composer takes the new text. */
  const setDraft = (/** @type {string} */ target, /** @type {string} */ text) => {
    if (text) s.drafts = { ...s.drafts, [target]: text };
    else {
      const { [target]: _gone, ...rest } = s.drafts;
      s.drafts = rest;
    }
    s.revs = { ...s.revs, [target]: (s.revs[target] ?? 0) + 1 };
    saveDrafts();
  };

  /** Where a composer target sends: its conversation and, for a thread, the root. */
  const destination = (/** @type {string} */ target) => {
    if (target.startsWith("thread:")) {
      const rootKey = target.slice("thread:".length);
      const root = s.thread?.root.key === rootKey ? s.thread.root : s.recent.get(rootKey);
      if (!root) throw new Error("That thread is not open any more.");
      return { conversation: root.conversation, thread: root.thread ?? root.id, root };
    }
    return { conversation: target.slice("conversation:".length) };
  };

  /** A message on screen that the index does not hold yet, made from what was typed. */
  const pendingOf = (
    /** @type {string} */ conversation,
    /** @type {string} */ text,
    /** @type {string | undefined} */ thread,
  ) => {
    const ref = load.refOf(conversation) ?? conversationRef(conversation);
    if (!ref) throw new Error("Open a conversation first.");
    const c = s.byKey.get(conversation);
    sent += 1;
    return chatOf({
      kind: "message",
      source: ref.source,
      id: `pending:${now()}:${sent}`,
      title: text.split("\n")[0] ?? "",
      updatedAt: iso(),
      from: { name: "You" },
      receivedAt: iso(),
      unread: false,
      body: text,
      ...(thread ? { thread } : {}),
      raw: {
        channel: ref.channel,
        channelName: c?.name ?? ref.channel,
        channelKind: c?.kind ?? "channel",
        platform: c?.platform.id ?? "",
        workspace: c?.workspace ?? ref.source.instance,
        self: true,
      },
    });
  };

  /** Send one pending message; it settles when the index holds it (sync.js) or fails with Retry. */
  const deliver = async (/** @type {import("./state.js").Sending} */ p) => {
    const { message } = p;
    p.state = "sending";
    delete p.error;
    render();
    try {
      const result = /** @type {{ id?: unknown } | undefined} */ (
        await actions.run(message.source.connector, "send", {
          instance: message.source.instance,
          channel: message.channel,
          text: p.text,
          ...(message.thread ? { thread: message.thread } : {}),
        })
      );
      const id = typeof result?.id === "string" && result.id !== "" ? result.id : undefined;
      if (id && s.recent.has(messageKey(message.source, id)))
        s.sending = s.sending.filter((x) => x !== p);
      else {
        p.state = "sent";
        if (id) p.message = { ...p.message, id };
      }
      say("");
    } catch (error) {
      p.state = "failed";
      p.error = error instanceof Error ? error.message : String(error);
      say(p.error);
    } finally {
      render();
    }
  };

  return {
    /** The person typed in a composer: kept, and stored a moment later. */
    type(/** @type {string} */ target, /** @type {string} */ text) {
      if (text) s.drafts = { ...s.drafts, [target]: text };
      else {
        const { [target]: _gone, ...rest } = s.drafts;
        s.drafts = rest;
      }
      clearTimeout(saving);
      saving = setTimeout(saveDrafts, saveMs);
    },

    /**
     * Send a composer's text, or the text an agent gave, to a conversation or a thread. While the
     * person edits a message in that composer, sending saves the edit instead.
     * @param {string} target a composer target
     * @param {string} [given]
     */
    async send(target, given) {
      const text = (given ?? s.drafts[target] ?? "").trim();
      if (!text) throw new Error("Write something first.");
      if (given === undefined && s.editing?.target === target) {
        const editing = s.editing;
        const message =
          s.recent.get(editing.key) ??
          [...(s.open?.messages ?? []), ...(s.thread?.replies ?? [])].find(
            (m) => m.key === editing.key,
          );
        s.editing = null;
        setDraft(target, "");
        if (!message) throw new Error("That message is not here any more.");
        if (message.text.trim() === text) return message.key;
        await this.edit(message, text);
        return message.key;
      }
      const { conversation, thread } = destination(target);
      const message = pendingOf(conversation, text, thread);
      if (!can(message.source.connector, "send"))
        throw new Error(
          `${message.source.connector} cannot send messages: it provides no ${message.source.connector}.chat.send.`,
        );
      /** @type {import("./state.js").Sending} */
      const p = { key: message.key, target, message, state: "sending", text, sentAt: now() };
      s.sending = [...s.sending, p];
      if (given === undefined) setDraft(target, "");
      await deliver(p);
      if (p.state === "failed") throw new Error(p.error);
      return p.message.id;
    },

    /** Send a failed message again. */
    async retry(/** @type {string} */ key) {
      const p = s.sending.find((x) => x.key === key);
      if (!p) throw new Error("That message is not waiting to be sent.");
      await deliver(p);
      if (p.state === "failed") throw new Error(p.error);
    },

    /** Forget a failed message; its text goes back into its composer when that is empty. */
    discard(/** @type {string} */ key) {
      const p = s.sending.find((x) => x.key === key);
      if (!p) return;
      s.sending = s.sending.filter((x) => x !== p);
      if (!s.drafts[p.target]) setDraft(p.target, p.text);
      render();
    },

    /** Put one of the person's messages in its composer to edit; Escape cancels. */
    startEdit(/** @type {ChatMessage} */ message) {
      if (!message.self) throw new Error("Only your own messages can be edited.");
      if (!can(message.source.connector, "edit"))
        throw new Error(
          `${message.source.connector} cannot edit messages: it provides no ${message.source.connector}.chat.edit.`,
        );
      const target =
        message.isReply && message.thread
          ? threadTarget(`${message.source.connector}/${message.source.instance}#${message.thread}`)
          : conversationTarget(message.conversation);
      s.editing = { key: message.key, target, text: message.text };
      setDraft(target, message.text);
      render();
      return target;
    },
    cancelEdit() {
      const editing = s.editing;
      if (!editing) return false;
      s.editing = null;
      setDraft(editing.target, "");
      render();
      return true;
    },

    /** Replace a message's text. */
    edit: (/** @type {ChatMessage} */ message, /** @type {string} */ text) => {
      const raw = { ...(message.item.raw ?? {}), editedAt: iso() };
      const after = { ...message.item, body: text, title: text.split("\n")[0] ?? "", raw };
      return sync.change([message], [after], "edit", { id: message.id, text }, "Edited.");
    },

    /** Delete a message. */
    remove: (/** @type {ChatMessage} */ message) =>
      sync.change([message], [], "delete", { id: message.id }, "Deleted."),

    /** Add the person's reaction, or take it back when it is there. */
    react: async (/** @type {ChatMessage} */ message, /** @type {string} */ emoji) => {
      const shown = emojiOf(emoji);
      const held = message.reactions.find((r) => sameEmoji(r.emoji, shown));
      const on = !held?.self;
      const reactions = held
        ? message.reactions
            .map((r) => (r === held ? { ...r, count: r.count + (on ? 1 : -1), self: on } : r))
            .filter((r) => r.count > 0)
        : [...message.reactions, { emoji: shown, count: 1, self: true }];
      const after = { ...message.item, raw: { ...(message.item.raw ?? {}), reactions } };
      await sync.change([message], [after], "react", { id: message.id, emoji: shown, on }, "");
      return on;
    },

    /**
     * Mark a conversation read up to its newest message. `quiet` when the plugin does it itself on
     * opening: a connector without the action is then left alone.
     */
    markRead: async (/** @type {string} */ key, quiet = false) => {
      const ref = load.refOf(key);
      if (!ref) throw new Error(`${key} is not a conversation.`);
      const unread = [...s.unread.values()].filter((m) => m.conversation === key);
      if (unread.length === 0) return 0;
      if (!can(ref.source.connector, "read")) {
        if (quiet) return 0;
        throw new Error(
          `${ref.source.connector} cannot mark messages read: it provides no ${ref.source.connector}.chat.read.`,
        );
      }
      const latest = s.byKey.get(key)?.latest;
      const held = s.open && s.current === key ? s.open.messages : [];
      const newest = [...unread, ...held, ...(latest ? [latest] : [])]
        .filter((m) => !m.id.startsWith("pending:"))
        .sort((a, b) => b.time - a.time)[0];
      const after = unread.map((m) => ({ ...m.item, unread: false }));
      await sync.change(unread, after, "read", { id: newest?.id }, quiet ? "" : "Marked read.");
      return unread.length;
    },

    /** The message a command names (`{ source, id }`, from an agent), the selected one, or none. */
    named(/** @type {Record<string, unknown>} */ a) {
      const source = /** @type {{ connector?: unknown, instance?: unknown }} */ (a.source ?? {});
      if (
        typeof a.id === "string" &&
        typeof source.connector === "string" &&
        typeof source.instance === "string"
      )
        return `${source.connector}/${source.instance}#${a.id}`;
      if (typeof a.key === "string" && messageRef(a.key)) return a.key;
      return s.selected;
    },
  };
}
