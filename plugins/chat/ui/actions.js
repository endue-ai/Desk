// The chat plugin's side of the bridge: reading chat messages from the desk's index (data.* under
// its data:read grant, with one ask on a refusal) and acting through the commands every chat
// connector provides by one convention (cmd.invoke under cmd:invoke). A connector `acme.slack`
// provides `acme.slack.chat.send`, `.chat.react`, `.chat.read`, `.chat.edit` and `.chat.delete`;
// views, Eris and agents run the same ids. Every failure is an Error whose message is the
// sentence the person reads.
import { safeHref } from "./markup.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("@endue-ai/bridge").ItemQuery} ItemQuery
 * @typedef {import("@endue-ai/bridge").ItemPage} ItemPage
 * @typedef {import("@endue-ai/bridge").DataReadPermission} DataReadPermission
 * @typedef {import("@endue-ai/bridge").ItemSource} ItemSource
 * @typedef {import("./state.js").Action} Action
 */

/** The actions a chat connector provides, as the suffix of its command ids. */
export const ACTIONS = /** @type {const} */ (["send", "react", "read", "edit", "delete"]);
/** The cmd:invoke patterns that cover them, whichever connector provides them. */
export const ACTION_PATTERNS = ACTIONS.map((action) => `*.chat.${action}`);
/** The scope every read carries: message items of every connector. */
export const READ = /** @type {DataReadPermission} */ ({
  permission: "data:read",
  kinds: ["message"],
});
/** The links a message may open: in the browser or the mail app (ADR 0047). */
export const LINKS = /** @type {const} */ ({
  permission: "shell:open",
  schemes: ["http", "https", "mailto"],
});
const NAME = "the chat plugin";
/** What each action is, in the sentence that says a connector lacks it. */
const VERBS = /** @type {Record<Action, string>} */ ({
  send: "send messages",
  react: "react",
  read: "mark messages read",
  edit: "edit messages",
  delete: "delete messages",
});

const codeOf = (/** @type {unknown} */ error) =>
  /** @type {{ code?: string }} */ (error)?.code ?? "error";
/** A CommandFailed reads "acme.slack.chat.send: failed: <why>"; the person gets the why. */
const whyOf = (/** @type {unknown} */ error) =>
  (error instanceof Error ? error.message : String(error)).replace(/^[a-z.*-]+: [a-z_]+: /, "");

/** The command id of an action of the connector a source belongs to. */
export const actionId = (/** @type {string} */ connector, /** @type {Action} */ action) =>
  `${connector}.chat.${action}`;

/** @param {Pick<PluginContext, "bridge" | "commands">} ctx */
export function createActions({ bridge, commands }) {
  let asked = false;

  /**
   * A read under the data:read scope; a refusal is asked for once per session, then said.
   * @template T
   * @param {string} what
   * @param {() => Promise<T>} call
   * @returns {Promise<T>}
   */
  const read = async (what, call) => {
    const refused = new Error(`Not allowed to read ${what}.`);
    try {
      return await call();
    } catch (error) {
      if (codeOf(error) !== "permission_denied")
        throw new Error(`Could not read ${what}: ${codeOf(error)}.`);
      if (asked) throw refused;
    }
    asked = true;
    const decision = await bridge
      .call("perm.request", { permission: READ, reason: `To show your chats in ${NAME}` })
      .catch(() => ({ granted: false }));
    if (!decision.granted) throw refused;
    try {
      return await call();
    } catch (error) {
      throw codeOf(error) === "permission_denied"
        ? refused
        : new Error(`Could not read ${what}: ${codeOf(error)}.`);
    }
  };

  return {
    /** One page of messages. @param {ItemQuery} query @returns {Promise<ItemPage>} */
    query: (query) => read("messages", () => bridge.call("data.query", { query, scope: READ })),

    /** One message by its source and id, or undefined. */
    get: async (/** @type {ItemSource} */ source, /** @type {string} */ id) =>
      (await read("the message", () => bridge.call("data.get", { source, id, scope: READ }))).item,

    /** Hear the index change for chat messages; resolves with the subscription id. */
    subscribe: (/** @type {ItemQuery} */ query) =>
      read("changes to messages", () => bridge.call("data.subscribe", { query, scope: READ })).then(
        ({ subscriptionId }) => subscriptionId,
      ),

    /** The accounts that bring messages in, as `connector/instance`. */
    accounts: async () => {
      const catalog = await bridge.call("catalog.get", {}).catch(() => ({ connectors: [] }));
      return catalog.connectors
        .filter((c) => c.kinds.some((k) => k.kind === "message"))
        .flatMap((c) => c.instances.map((instance) => `${c.id}/${instance}`))
        .sort();
    },

    /** Which actions each connector provides, by its command ids in the registry. */
    available: async () => {
      const { commands: list } = await bridge
        .call("cmd.list", { scope: { permission: "cmd:invoke", ids: ACTION_PATTERNS } })
        .catch(() => ({ commands: [] }));
      /** @type {Map<string, Set<Action>>} */
      const out = new Map();
      for (const { id } of list) {
        // The plugin's own commands (endue.chat.send) are not a connector's.
        if (id.startsWith("endue.chat.")) continue;
        const match = /^(.+)\.chat\.(send|react|read|edit|delete)$/.exec(id);
        if (!match) continue;
        const [, connector = "", action] = match;
        const set = out.get(connector) ?? new Set();
        set.add(/** @type {Action} */ (action));
        out.set(connector, set);
      }
      return out;
    },

    /**
     * Run an action of a connector. A connector without it, or a failure, is one sentence.
     * @param {string} connector
     * @param {Action} action
     * @param {Record<string, unknown>} args
     */
    run: async (connector, action, args) => {
      const id = actionId(connector, action);
      try {
        return await commands.run(id, args);
      } catch (error) {
        const code = codeOf(error);
        if (code === "unknown_command")
          throw new Error(`${connector} cannot ${VERBS[action]}: it provides no ${id}.`);
        if (code === "permission_denied") throw new Error(`Not allowed to run ${id}.`);
        throw new Error(`Could not ${action}: ${whyOf(error)}`.replace(/\.?$/, "."));
      }
    },

    /**
     * The person picks one of the items, or types an answer when `free`; undefined when nothing.
     * @param {{ title: string, items?: Array<{ id: string, label: string, detail?: string }>,
     *   free?: boolean, placeholder?: string }} ask
     */
    pick: async (ask) => {
      try {
        const answer = await commands.run("desk.palette.pick", {
          items: [],
          free: false,
          ...ask,
        });
        return typeof answer === "string" && answer !== "" ? answer : undefined;
      } catch (error) {
        if (codeOf(error) !== "unknown_command") return undefined;
        throw new Error(`${ask.title}: the palette is not available.`);
      }
    },

    /** Tell the person something outside the surface; silently nothing without ui:notify. */
    notify: (/** @type {string} */ title, /** @type {string} */ body) =>
      bridge
        .call("ui.notify", { title, body, level: "info", scope: { permission: "ui:notify" } })
        .catch(() => undefined),

    /** Open a link of a message in the browser or the mail app; other schemes are refused. */
    open: async (/** @type {string} */ url) => {
      const href = safeHref(url);
      if (!href) throw new Error("Only web and mail links open from a message.");
      try {
        await bridge.call("shell.open", { target: href, scope: LINKS });
      } catch (error) {
        throw new Error(
          codeOf(error) === "permission_denied"
            ? "Not allowed to open links."
            : `Could not open the link: ${codeOf(error)}.`,
        );
      }
    },
  };
}
