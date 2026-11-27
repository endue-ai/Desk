// The plugin's commands (contributes.commands in plugin.json), answered by name: the palette, keys,
// Eris, agents and the plugin's own buttons all arrive here. A failure goes to the status line and
// ends the command with the same words, which the desk shows in its notice. Agents name what they
// act on: `{ source, channel }` a conversation, `{ source, id }` a message.
import { QUICK_REACTIONS } from "./emoji.js";
import { conversationKey, messageKey } from "./model.js";
import { LAYOUTS } from "./query.js";
import { asArgs, asSource, asString, conversationTarget, threadTarget } from "./state.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("@endue-ai/plugin-sdk").Invocation} Invocation
 * @typedef {(args: Record<string, unknown>, invocation?: Invocation) => unknown} Handler
 * @typedef {import("./model.js").ChatMessage} ChatMessage
 * @typedef {import("./model.js").Conversation} Conversation
 * @typedef {{
 *   commands: PluginContext["commands"], surface: PluginContext["surface"],
 *   view: { focus(where: string): void },
 *   say(text: string): void,
 *   pick: ReturnType<typeof import("./actions.js").createActions>["pick"],
 *   writing: ReturnType<typeof import("./writing.js").createWriting>,
 *   app: {
 *     layout(): string, current(): string | null, conversations(platform?: string): Conversation[],
 *     message(key: string | null): Promise<ChatMessage>,
 *     lastOwn(target?: string): ChatMessage | undefined,
 *     openConversation(key: string, select?: string): Promise<string>,
 *     openThread(root: ChatMessage): Promise<void>,
 *     draft(key: string, root: ChatMessage | undefined, text: string): Promise<string>,
 *     setLayout(id: string): Promise<string>, setFilter(id: string): Promise<string>,
 *     setPlatform(id: string | null): Promise<string>, setSearch(text: string): Promise<string>,
 *     refresh(): Promise<void>, nextUnread(): Promise<string>,
 *     toggleSave(message: ChatMessage): boolean, togglePin(key: string): boolean,
 *     find(query: string, limit: number): unknown, connect(): Promise<void>,
 *   },
 * }} Deps
 */

const NAME = "the chat plugin";
const fromAgent = (/** @type {Invocation | undefined} */ invocation) =>
  invocation?.caller.startsWith("agent:") === true;

/** @param {Deps} deps */
export function registerCommands({ commands, surface, view, say, pick, writing, app }) {
  /** @type {Map<string, Handler>} */
  const own = new Map();

  /** @param {string} name @param {unknown} raw @param {Invocation} [invocation] */
  const command = async (name, raw, invocation) => {
    const handler = own.get(name);
    if (!handler) throw new Error(`${NAME} has no command ${name}.`);
    try {
      return await handler(asArgs(raw), invocation);
    } catch (error) {
      say(error instanceof Error ? error.message : String(error));
      throw error;
    }
  };
  /** @type {(name: string, handler: Handler) => void} */
  const answer = (name, handler) => {
    own.set(name, handler);
    commands.on(name, (raw, invocation) => command(name, raw, invocation));
  };

  /** The conversation a command names, or the open one. */
  const conversationOf = (/** @type {Record<string, unknown>} */ a) => {
    const source = asSource(a.source);
    const channel = asString(a.channel);
    if (source && channel) return conversationKey(source, channel);
    const key = asString(a.conversation) ?? app.current();
    if (!key) throw new Error("Open a conversation first.");
    return key;
  };
  /** The message a command names, or the selected one. */
  const messageOf = (/** @type {Record<string, unknown>} */ a, named = false) => {
    const key = writing.named(a, !named);
    if (!key)
      throw new Error(named ? "Name the message by its source and id." : "Select a message first.");
    return app.message(key);
  };
  const shown = (/** @type {string} */ where) => {
    surface.show();
    view.focus(where);
  };

  answer("endue.chat.open", () => {
    shown("list");
    return app.layout();
  });
  answer("endue.chat.show", async (a) => {
    const message = await messageOf(a);
    await app.openConversation(message.conversation, message.key);
    if (message.isReply) {
      const root = await app
        .message(`${message.source.connector}/${message.source.instance}#${message.thread}`)
        .catch(() => undefined);
      if (root) await app.openThread(root);
    }
    shown(message.isReply ? "thread" : "messages");
    return message.key;
  });
  answer("endue.chat.conversation", async (a) => {
    const named = a.source || a.channel || a.conversation ? conversationOf(a) : undefined;
    const key =
      named ??
      (await pick({
        title: "Go to a conversation",
        placeholder: "channel, person or workspace",
        items: app.conversations().map((c) => ({
          id: c.key,
          label: c.kind === "dm" || c.kind === "group" ? c.name : `#${c.name}`,
          detail: `${c.platform.name} · ${c.workspace}${c.unread ? ` · ${c.unread} unread` : ""}`,
        })),
      }));
    if (!key) return app.current();
    await app.openConversation(key);
    shown("composer");
    return key;
  });
  answer("endue.chat.layout", (a) => {
    const id = asString(a.layout);
    if (id) return app.setLayout(id);
    const at = LAYOUTS.findIndex((l) => l.id === app.layout());
    return app.setLayout(LAYOUTS[(at + 1) % LAYOUTS.length]?.id ?? "conversation");
  });
  answer("endue.chat.filter", (a) => app.setFilter(asString(a.filter) ?? "all"));
  answer("endue.chat.platform", (a) => {
    const id = asString(a.platform);
    return app.setPlatform(id === undefined || id === "all" ? null : id);
  });
  answer("endue.chat.search", async (a, invocation) => {
    if (fromAgent(invocation) && typeof a.text !== "string")
      throw new Error("Give the search text.");
    const text =
      typeof a.text === "string"
        ? a.text
        : await pick({ title: "Search chats", placeholder: "words to find", free: true });
    if (text === undefined) return "";
    const result = await app.setSearch(text);
    surface.show();
    return result;
  });
  answer("endue.chat.refresh", () => app.refresh());
  answer("endue.chat.next-unread", async () => {
    const key = await app.nextUnread();
    shown("messages");
    return key;
  });
  answer("endue.chat.draft", async (a) => {
    const source = asSource(a.source);
    const channel = asString(a.channel);
    const text = asString(a.text);
    if (!source || !channel || !text?.trim())
      throw new Error("Name a conversation and draft text.");
    const key = conversationKey(source, channel);
    const thread = asString(a.thread);
    const root = thread ? await app.message(messageKey(source, thread)) : undefined;
    if (root && (root.conversation !== key || root.isReply))
      throw new Error("That thread is not a root in the named conversation.");
    const target = await app.draft(key, root, text);
    shown(root ? "thread" : "composer");
    return target;
  });
  answer("endue.chat.send", async (a) => {
    const text = asString(a.text);
    const thread = asString(a.thread);
    if (thread) {
      const key = conversationOf(a);
      const root = await app.message(`${key.slice(0, key.indexOf("@"))}#${thread}`);
      return writing.send(threadTarget(root.key), text);
    }
    const target = asString(a.target) ?? conversationTarget(conversationOf(a));
    return writing.send(target, text);
  });
  answer("endue.chat.reply", async (a) => {
    const message = await messageOf(a);
    const root =
      message.isReply && message.thread
        ? await app.message(
            `${message.source.connector}/${message.source.instance}#${message.thread}`,
          )
        : message;
    await app.openThread(root);
    shown("thread");
    return root.key;
  });
  answer("endue.chat.react", async (a, invocation) => {
    const agent = fromAgent(invocation);
    const message = await messageOf(a, agent);
    if (agent && !asString(a.emoji)) throw new Error("Give the reaction's emoji.");
    const emoji =
      asString(a.emoji) ??
      (await pick({
        title: "React with",
        placeholder: "an emoji or :name:",
        free: true,
        items: QUICK_REACTIONS.map((e) => ({ id: e, label: e })),
      }));
    if (!emoji) return undefined;
    return writing.react(message, emoji, typeof a.on === "boolean" ? a.on : undefined);
  });
  answer("endue.chat.edit", async (a, invocation) => {
    const text = asString(a.text);
    const agent = fromAgent(invocation);
    if (agent && !text?.trim()) throw new Error("Give the new message text.");
    // `{ last: true, target }` is the empty composer's ArrowUp: the person's newest message there.
    const key = !agent && a.last === true ? null : writing.named(a, !agent);
    if (agent && !key) throw new Error("Name the message by its source and id.");
    const message = key ? await app.message(key) : app.lastOwn(asString(a.target));
    if (!message) throw new Error("You have no message here to edit.");
    if (text !== undefined) {
      if (!message.self) throw new Error("Only your own messages can be edited.");
      await writing.edit(message, text);
      return message.key;
    }
    writing.startEdit(message);
    shown(message.isReply ? "thread" : "composer");
    return message.key;
  });
  answer("endue.chat.delete", async (a, invocation) => {
    const agent = fromAgent(invocation);
    const message = await messageOf(a, agent);
    if (!message.self) throw new Error("Only your own messages can be deleted.");
    if (!agent && a.confirmed !== true) {
      const sure = await pick({
        title: "Delete this message?",
        items: [
          {
            id: "delete",
            label: "Delete",
            detail: message.text.split("\n")[0]?.slice(0, 80) ?? "",
          },
          { id: "keep", label: "Keep it" },
        ],
      });
      if (sure !== "delete") return false;
    }
    await writing.remove(message);
    return true;
  });
  answer("endue.chat.mark-read", (a) => writing.markRead(conversationOf(a)));
  answer("endue.chat.mark-all-read", async (a) => {
    let n = 0;
    for (const c of app.conversations(asString(a.platform)).filter((x) => x.unread > 0))
      n += await writing.markRead(c.key);
    say(n ? `Marked ${n} ${n === 1 ? "message" : "messages"} read.` : "Nothing unread.");
    return n;
  });
  answer("endue.chat.save", async (a) => {
    const message = await messageOf(a);
    const saved = app.toggleSave(message);
    say(saved ? "Saved." : "Removed from Saved.");
    return saved;
  });
  answer("endue.chat.pin", (a) => {
    const key = conversationOf(a);
    const pinned = app.togglePin(key);
    say(pinned ? "Pinned as a column." : "Unpinned.");
    return pinned;
  });
  answer("endue.chat.find", (a) => app.find(asString(a.query) ?? "", Number(a.limit) || 8));
  // The empty state's Connect an account: Settings, Connections, message connectors first.
  answer("endue.chat.connect", () => app.connect());

  return { command, answer, ids: () => [...own.keys()] };
}
