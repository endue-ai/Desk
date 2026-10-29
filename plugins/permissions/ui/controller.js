// The permissions plugin without its DOM: it lists every caller's grants and revokes them, and it is
// the prompter, answering perm.prompt one at a time. It only talks to the bridge and to a view, so the
// SDK's test host runs it with a recording view.
import { describeCaller, describePermission, durationLabel } from "./describe.js";
import { grantList, promptModel } from "./model.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("@endue-ai/bridge").CallerGrant} CallerGrant
 * @typedef {import("@endue-ai/bridge").PermPromptData} PermPromptData
 * @typedef {import("@endue-ai/bridge").PluginInfo} PluginInfo
 * @typedef {import("./model.js").GrantList} GrantList
 * @typedef {import("./model.js").PromptModel} PromptModel
 * @typedef {{ grants(list: GrantList): void, prompt(model: PromptModel | null): void,
 *   status(text: string): void }} View
 * @typedef {"once" | "session" | "always" | "refuse"} Choice
 */

const MANAGE = { permission: "perm:manage" };
const PLUGINS = { permission: "plugin:manage" };
const SURFACE = { permission: "ui:surface" };
const CHANGES = { permission: "events:subscribe", names: ["perm.changed"] };
const DURATIONS = new Set(["once", "session", "always"]);

const codeOf = (/** @type {unknown} */ error) =>
  /** @type {{ code?: string }} */ (error)?.code ?? "error";

/**
 * @param {Pick<PluginContext, "bridge">} ctx
 * @param {View} view
 */
export function createPermissions({ bridge }, view) {
  /** @type {PluginInfo[]} */
  let plugins = [];
  /** The latest perm.list answer, null before the first one. @type {CallerGrant[] | null} */
  let grants = null;
  /** Prompts in arrival order; the first one is on screen. @type {PermPromptData[]} */
  const queue = [];
  /**
   * The prompt surface while it is open or opening: its handle, or null when it could not open.
   * @type {Promise<string | null> | null}
   */
  let overlay = null;
  let answering = false;
  let listing = 0;

  const showGrants = () => {
    if (grants) view.grants(grantList(grants, plugins));
  };
  const showPrompt = () => {
    const [front] = queue;
    view.prompt(front ? promptModel(front, plugins, queue.length - 1) : null);
  };

  /** Show what is on screen again with fresh plugin names. */
  const showNames = () => {
    showGrants();
    if (queue.length > 0) showPrompt();
  };

  /** Names and kinds of installed plugins; without plugin:manage the ids stand in. */
  const loadPlugins = async () => {
    try {
      ({ plugins } = await bridge.call("plugin.list", { scope: PLUGINS }));
    } catch {
      plugins = [];
    }
  };

  const refresh = async () => {
    const mine = ++listing;
    try {
      const result = await bridge.call("perm.list", { scope: MANAGE });
      // A newer listing may have answered first; the latest call wins.
      if (mine !== listing) return;
      grants = result.grants;
      showGrants();
    } catch (error) {
      if (mine === listing) view.status(`Could not list permissions: ${codeOf(error)}.`);
    }
  };

  /** Other callers' perm.changed events reach only subscribers; refused, own changes still arrive. */
  const subscribe = () =>
    bridge.call("events.subscribe", { names: ["perm.changed"], scope: CHANGES }).catch(() => {});

  const raise = () => {
    overlay ??= bridge
      .call("ui.surface.open", { surface: "prompt", title: "Permission request", scope: SURFACE })
      .then(
        ({ handle }) => handle,
        // The prompt stays in this plugin's own frame.
        () => null,
      );
  };

  const lower = () => {
    const opened = overlay;
    overlay = null;
    void opened?.then((handle) => {
      if (handle) bridge.call("ui.surface.close", { handle, scope: SURFACE }).catch(() => {});
    });
  };

  /** @param {PermPromptData} prompt */
  const enqueue = (prompt) => {
    if (queue.some((p) => p.promptId === prompt.promptId)) return;
    queue.push(prompt);
    raise();
    showPrompt();
  };

  /** @param {string} grantId */
  const revoke = async (grantId) => {
    const held = grants?.find((g) => g.grant.grantId === grantId);
    if (!held) return;
    const { label } = describePermission(held.grant.permission);
    const { name } = describeCaller(held.caller, plugins);
    try {
      await bridge.call("perm.revoke", { grantId, scope: MANAGE });
    } catch (error) {
      view.status(`Could not revoke ${label} from ${name}: ${codeOf(error)}.`);
      return;
    }
    view.status(`Revoked ${label} from ${name}.`);
    await refresh();
  };

  /**
   * Answer the prompt on screen. Any failure (decided, withdrawn or refused) still moves on, so the
   * overlay never traps the person.
   * @param {Choice} choice
   */
  const answer = async (choice) => {
    const [prompt] = queue;
    if (!prompt || answering || (choice !== "refuse" && !DURATIONS.has(choice))) return;
    answering = true;
    const granted = choice !== "refuse";
    const { label } = describePermission(prompt.permission);
    const { name } = describeCaller(prompt.caller, plugins);
    let said;
    try {
      await bridge.call("perm.answer", {
        promptId: prompt.promptId,
        granted,
        ...(granted ? { duration: choice } : {}),
        scope: MANAGE,
      });
      said = granted
        ? `Allowed ${name}: ${label} (${durationLabel(choice)}).`
        : `Refused ${name}: ${label}.`;
    } catch (error) {
      said = `Could not answer ${name}: ${codeOf(error)}.`;
    }
    answering = false;
    queue.shift();
    if (queue.length === 0) lower();
    showPrompt();
    // The dialog stays open for the next prompt; the live region says that it changed.
    const [next] = queue;
    view.status(next ? `${said} Next: ${promptModel(next, plugins, 0).title}.` : said);
  };

  /**
   * Keys the plugin handles wherever focus is. Returns whether the key was used.
   * @param {string} key
   */
  const key = (key) => {
    if (key !== "Escape" || queue.length === 0) return false;
    void answer("refuse");
    return true;
  };

  bridge.onEvent((event) => {
    if (event.event === "perm.changed") void refresh();
    else if (event.event === "perm.prompt") enqueue(event.data);
    else if (event.event === "plugin.changed") void loadPlugins().then(showNames);
  });

  const ready = (async () => {
    await Promise.all([loadPlugins(), subscribe()]);
    showNames();
    await refresh();
  })();

  return { ready, revoke, answer, key };
}
