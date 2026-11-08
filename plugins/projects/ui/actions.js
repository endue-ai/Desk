// The plugin's side of the bridge: reading task items from the desk's index (data.* under its
// data:read grant, with one ask on a refusal) and acting on them through the commands a task
// connector provides (cmd.invoke under cmd:invoke). A connector `acme.jira` that brings tasks in
// provides `acme.jira.task.move { instance, id, status }` and `acme.jira.task.update { instance,
// id, due?, start?, priority?, assignee? }`; views, Eris and agents run the same ids. Every
// failure is an Error whose message is the sentence the person reads.

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("@endue-ai/bridge").ItemQuery} ItemQuery
 * @typedef {import("@endue-ai/bridge").ItemPage} ItemPage
 * @typedef {import("@endue-ai/bridge").DataReadPermission} DataReadPermission
 * @typedef {import("@endue-ai/bridge").Item} Item
 * @typedef {import("@endue-ai/bridge").ItemSource} ItemSource
 * @typedef {import("./state.js").Action} Action
 */

import { anyOf, NO_TASK_CONNECTOR } from "./state.js";

/** The actions a task connector provides, as the suffix of its command ids. */
export const ACTIONS = /** @type {const} */ (["move", "update"]);
/** The cmd:invoke patterns that cover them, whichever connector provides them. */
export const ACTION_PATTERNS = ACTIONS.map((action) => `*.task.${action}`);
/** The scope every read carries: task items of every connector. */
export const READ = /** @type {DataReadPermission} */ ({
  permission: "data:read",
  kinds: ["task"],
});
/** The scope of connector.list: which connectors are installed, connected or not. */
export const CONNECTORS = /** @type {const} */ ({ permission: "connector:manage" });
/** The links the plugin opens: the original issue, on the web. */
export const LINKS = /** @type {const} */ ({ permission: "shell:open", schemes: ["https"] });
const NAME = "the projects plugin";

const codeOf = (/** @type {unknown} */ error) =>
  /** @type {{ code?: string }} */ (error)?.code ?? "error";
/** A CommandFailed reads "acme.jira.task.move: failed: <why>"; the person gets the why. */
const whyOf = (/** @type {unknown} */ error) =>
  (error instanceof Error ? error.message : String(error)).replace(/^[a-z.*-]+: [a-z_]+: /, "");

/** The command id of an action of the connector a source belongs to. */
export const actionId = (/** @type {string} */ connector, /** @type {Action} */ action) =>
  `${connector}.task.${action}`;

/** @param {Pick<PluginContext, "bridge" | "commands">} ctx */
export function createActions({ bridge, commands }) {
  let asked = false;

  /** The installed connectors that bring tasks, by name, connected or not; none when unknown. */
  const installed = async () => {
    const listed = await bridge
      .call("connector.list", { scope: CONNECTORS })
      .catch(() => ({ connectors: [] }));
    const bringing = listed.connectors.filter((c) => c.resources.some((r) => r.kind === "task"));
    return [...new Set(bringing.map((c) => c.title ?? c.id))];
  };

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
      .call("perm.request", { permission: READ, reason: `To show your tasks in ${NAME}` })
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
    /** One page of tasks. @param {ItemQuery} query @returns {Promise<ItemPage>} */
    query: (query) => read("tasks", () => bridge.call("data.query", { query, scope: READ })),

    /** One task by its source and id, or undefined. */
    get: async (/** @type {ItemSource} */ source, /** @type {string} */ id) =>
      (await read("the task", () => bridge.call("data.get", { source, id, scope: READ }))).item,

    /** Hear the index change for task items; resolves with the subscription id. */
    subscribe: () =>
      read("changes to tasks", () =>
        bridge.call("data.subscribe", { query: { kinds: ["task"] }, scope: READ }),
      ).then(({ subscriptionId }) => subscriptionId),

    /** The connected sources with task items, as `connector/instance`. */
    sources: async () => {
      const catalog = await bridge.call("catalog.get", {}).catch(() => ({ connectors: [] }));
      return catalog.connectors
        .filter((c) => c.kinds.some((k) => k.kind === "task"))
        .flatMap((c) => c.instances.map((instance) => ({ connector: c.id, instance })));
    },

    installed,

    /** Which actions each connector provides, by its command ids in the registry. */
    available: async () => {
      const { commands } = await bridge
        .call("cmd.list", { scope: { permission: "cmd:invoke", ids: ACTION_PATTERNS } })
        .catch(() => ({ commands: [] }));
      /** @type {Record<string, Action[]>} */
      const out = {};
      for (const { id } of commands) {
        const match = /^(.+)\.task\.(move|update)$/.exec(id);
        if (!match?.[1]) continue;
        const list = out[match[1]] ?? [];
        list.push(/** @type {Action} */ (match[2]));
        out[match[1]] = list;
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
          throw new Error(`${connector} cannot ${action} tasks: it provides no ${id}.`);
        if (code === "permission_denied") throw new Error(`Not allowed to run ${id}.`);
        throw new Error(`Could not ${action} the task: ${whyOf(error)}`.replace(/\.?$/, "."));
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
        return typeof answer === "string" ? answer : undefined;
      } catch (error) {
        if (codeOf(error) !== "unknown_command") return undefined;
        throw new Error(`${title}: the palette is not available.`);
      }
    },

    /** Lead the person to connecting a task source, when an installed connector brings tasks. */
    connect: async () => {
      const names = await installed();
      if (names.length === 0) throw new Error(NO_TASK_CONNECTOR);
      try {
        await commands.run("desk.connectors.open", { kinds: ["task"] });
      } catch (error) {
        throw new Error(
          codeOf(error) === "unknown_command"
            ? `Connect ${anyOf(names)} from the desk's connectors first.`
            : `Could not open the connectors: ${whyOf(error)}`,
        );
      }
    },

    /** Open the original issue in the browser. */
    openLink: async (/** @type {string} */ url) => {
      if (!/^https:\/\//i.test(url)) throw new Error("Only https links open from here.");
      try {
        await bridge.call("shell.open", { target: url, scope: LINKS });
      } catch (error) {
        throw new Error(
          codeOf(error) === "permission_denied"
            ? "Not allowed to open links."
            : `Could not open the link: ${whyOf(error)}`,
        );
      }
    },
  };
}
