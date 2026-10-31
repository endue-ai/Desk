// The plugin's commands (contributes.commands in plugin.json), answered by name: the palette, keys,
// Eris, agents and the plugin's own buttons all arrive here. A failure goes to the status line and
// ends the command with the same words, which the desk shows in its notice.
import { asArgs, asString } from "./state.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("./model.js").Message} Message
 * @typedef {{
 *   commands: PluginContext["commands"], surface: PluginContext["surface"],
 *   view: { focus(where: "list" | "reader" | "composer"): void },
 *   say(text: string): void,
 *   app: {
 *     mailboxId(): string, search(): string, open(): Message | null,
 *     show(message: Message): Promise<void>, named(args: Record<string, unknown>): Promise<Message>,
 *     setMailbox(id: string): Promise<string>, setSearch(text: string): Promise<string>,
 *     refresh(): Promise<void>, pick(title: string, placeholder: string): Promise<string | undefined>,
 *     setFlags(message: Message, flags: { unread?: boolean, flagged?: boolean }): Promise<void>,
 *     moveTo(message: Message, role: string): Promise<void>,
 *   },
 *   writing: ReturnType<typeof import("./writing.js").createWriting>,
 * }} Deps
 */

const NAME = "the mail plugin";

/** @param {Deps} deps */
export function registerCommands({ commands, surface, view, say, app, writing }) {
  /** @type {Map<string, (args: Record<string, unknown>) => unknown>} */
  const own = new Map();

  /**
   * Run one of the plugin's commands.
   * @param {string} name
   * @param {unknown} raw
   */
  const command = async (name, raw) => {
    const handler = own.get(name);
    if (!handler) throw new Error(`${NAME} has no command ${name}.`);
    try {
      return await handler(asArgs(raw));
    } catch (error) {
      say(error instanceof Error ? error.message : String(error));
      throw error;
    }
  };
  /** @type {(name: string, handler: (a: Record<string, unknown>) => unknown) => void} */
  const answer = (name, handler) => {
    own.set(name, handler);
    commands.on(name, (raw) => command(name, raw));
  };
  const composing = (/** @type {string} */ id) => {
    surface.show();
    view.focus("composer");
    return id;
  };

  answer("endue.mail.open", () => {
    surface.show();
    view.focus(app.open() ? "reader" : "list");
    return app.mailboxId();
  });
  answer("endue.mail.show", async (a) => {
    const message = await app.named(a);
    await app.show(message);
    surface.show();
    view.focus("reader");
    return message.key;
  });
  answer("endue.mail.mailbox", (a) => app.setMailbox(asString(a.mailbox) ?? "inbox"));
  answer("endue.mail.search", async (a) => {
    const text = asString(a.text) ?? (await app.pick("Search mail", "words to find"));
    return text === undefined ? app.search() : app.setSearch(text);
  });
  answer("endue.mail.refresh", () => app.refresh());
  answer("endue.mail.compose", (a) => composing(writing.compose(a)));
  answer("endue.mail.reply", (a) => composing(writing.reply(a.all === true)));
  answer("endue.mail.forward", () => composing(writing.forward()));
  answer("endue.mail.send", () => writing.send());
  answer("endue.mail.discard", () => writing.discard());
  answer("endue.mail.archive", async (a) => app.moveTo(await app.named(a), "archive"));
  answer("endue.mail.trash", async (a) => app.moveTo(await app.named(a), "trash"));
  answer("endue.mail.flag", async (a) => {
    const message = await app.named(a);
    const flagged = typeof a.flagged === "boolean" ? a.flagged : !message.flagged;
    await app.setFlags(message, { flagged });
    return flagged;
  });
  answer("endue.mail.toggle-unread", async (a) => {
    const message = await app.named(a);
    const unread = typeof a.unread === "boolean" ? a.unread : !message.unread;
    await app.setFlags(message, { unread });
    return unread;
  });
  answer("endue.mail.rsvp", (a) => writing.rsvp(asString(a.status) ?? "", asString(a.address)));

  return { command, ids: () => [...own.keys()] };
}
