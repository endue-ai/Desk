// The mail plugin's side of the bridge: reading messages from the desk's index (data.* under its
// data:read grant, with one ask on a refusal) and acting on them through the commands a mail
// connector provides (cmd.invoke under cmd:invoke). A connector `acme.imap` that brings messages in
// provides `acme.imap.mail.send`, `.mail.move` and `.mail.flag`; views, Eris and agents run the same
// ids. Every failure is an Error whose message is the sentence the person reads.

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("@endue-ai/bridge").ItemQuery} ItemQuery
 * @typedef {import("@endue-ai/bridge").ItemPage} ItemPage
 * @typedef {import("@endue-ai/bridge").DataReadPermission} DataReadPermission
 * @typedef {import("@endue-ai/bridge").Item} Item
 * @typedef {import("@endue-ai/bridge").ItemSource} ItemSource
 * @typedef {"send" | "move" | "flag"} Action
 */

/** The actions a mail connector provides, as the suffix of its command ids. */
export const ACTIONS = /** @type {const} */ (["send", "move", "flag"]);
/** The cmd:invoke patterns that cover them, whichever connector provides them. */
export const ACTION_PATTERNS = ACTIONS.map((action) => `*.mail.${action}`);
/** The scope every read carries: message items of every connector. */
export const READ = /** @type {DataReadPermission} */ ({
  permission: "data:read",
  kinds: ["message"],
});
const NAME = "the mail plugin";

const codeOf = (/** @type {unknown} */ error) =>
  /** @type {{ code?: string }} */ (error)?.code ?? "error";
/** A CommandFailed reads "acme.imap.mail.send: failed: <why>"; the person gets the why. */
const whyOf = (/** @type {unknown} */ error) =>
  (error instanceof Error ? error.message : String(error)).replace(/^[a-z.*-]+: [a-z_]+: /, "");

/** The command id of an action of the connector a source belongs to. */
export const actionId = (/** @type {string} */ connector, /** @type {Action} */ action) =>
  `${connector}.mail.${action}`;

/**
 * @param {Pick<PluginContext, "bridge" | "commands">} ctx
 */
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
      .call("perm.request", { permission: READ, reason: `To show your mail in ${NAME}` })
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

  /** The command ids of the actions each connector provides, from the registry. */
  const provided = async () => {
    const { commands: list } = await bridge
      .call("cmd.list", { scope: { permission: "cmd:invoke", ids: ACTION_PATTERNS } })
      .catch(() => ({ commands: [] }));
    return new Set(list.map((c) => c.id));
  };

  return {
    /** One page of messages. @param {ItemQuery} query @returns {Promise<ItemPage>} */
    query: (query) => read("messages", () => bridge.call("data.query", { query, scope: READ })),

    /** One message by its source and id, or undefined. */
    get: async (/** @type {ItemSource} */ source, /** @type {string} */ id) =>
      (await read("the message", () => bridge.call("data.get", { source, id, scope: READ }))).item,

    /** Hear the index change for message items; resolves with the subscription id. */
    subscribe: (/** @type {ItemQuery} */ query) =>
      read("changes to messages", () => bridge.call("data.subscribe", { query, scope: READ })).then(
        ({ subscriptionId }) => subscriptionId,
      ),

    /** What the desk can show a view, or Eris, here: the connectors with message items. */
    accounts: async () => {
      const catalog = await bridge.call("catalog.get", {}).catch(() => ({ connectors: [] }));
      return catalog.connectors
        .filter((c) => c.kinds.some((k) => k.kind === "message"))
        .flatMap((c) => c.instances.map((instance) => `${c.id}/${instance}`));
    },

    /** Which actions a connector provides, by its command ids in the registry. */
    available: async (/** @type {string} */ connector) => {
      const ids = await provided();
      return ACTIONS.filter((action) => ids.has(actionId(connector, action)));
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
          throw new Error(`${connector} cannot ${action} mail: it provides no ${id}.`);
        if (code === "permission_denied") throw new Error(`Not allowed to run ${id}.`);
        throw new Error(`Could not ${action}: ${whyOf(error)}`.replace(/\.?$/, "."));
      }
    },

    /** The person types one answer in the palette; undefined when nothing was picked. */
    pick: async (/** @type {string} */ title, /** @type {string} */ placeholder) => {
      try {
        const answer = await commands.run("desk.palette.pick", {
          title,
          items: [],
          free: true,
          placeholder,
        });
        return typeof answer === "string" && answer !== "" ? answer : undefined;
      } catch (error) {
        if (codeOf(error) !== "unknown_command") return undefined;
        throw new Error(`${title}: the palette is not available.`);
      }
    },

    /** Tell the person something outside the surface; silently nothing without ui:notify. */
    notify: (/** @type {string} */ title, /** @type {string} */ body) =>
      bridge
        .call("ui.notify", { title, body, level: "info", scope: { permission: "ui:notify" } })
        .catch(() => undefined),
  };
}
