// The plugin's commands (endue.docker.*, from the palette, keys, Eris and agents), the desk's buffer
// requests, and the actions the view's keys run, all on the controller. No DOM.

import { hints, LISTS } from "./keys.js";
import { statsFor } from "./parse-engine.js";
import { containerTarget, projectName } from "./refs.js";
import { globalFlags } from "./run.js";
import { registerSchemas } from "./schemas.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginCommands} PluginCommands
 * @typedef {import("@endue-ai/plugin-sdk").PluginBridge} PluginBridge
 * @typedef {ReturnType<typeof import("./docker.js").createDocker>} App
 * @typedef {import("./docker.js").ListName} ListName
 * @typedef {Record<string, unknown>} Args
 */

const CONTEXT_DEFAULT = "@cli";

/**
 * @param {{ commands: PluginCommands, bridge: Pick<PluginBridge, "call"> }} ctx
 * @param {App} app
 * @param {{ selection(): import("./actions.js").Item | undefined }} view
 * @returns {Record<string, (...args: unknown[]) => unknown>} The actions the view's keys run.
 */
export function wireCommands({ commands, bridge }, app, view) {
  const { actions } = app;

  /** A list shown fresh; what it holds is the command's answer. */
  const list = async (/** @type {ListName} */ name) => (await app.showList(name)) ?? {};

  const containers = async (/** @type {Args} */ args) => {
    if (typeof args.all === "boolean") app.setAll(args.all);
    const model = await list("containers");
    return model.containers.map((/** @type {any} */ c) => ({
      ...c,
      stats: statsFor(model.stats, c.id) ?? null,
    }));
  };

  /** Open a terminal running a shell, or the command asked for, inside a running container. */
  const shell = async (/** @type {Args} */ args = {}) => {
    const { ref, name } = containerTarget(args, view.selection(), app.shown());
    const command = args.command === undefined ? [app.settings().shell] : args.command;
    if (
      !Array.isArray(command) ||
      command.length === 0 ||
      !command.every((p) => typeof p === "string" && p !== "" && !p.includes("\0"))
    )
      throw new Error("command is the program and its arguments, as a list of text.");
    try {
      return await commands.run("endue.terminal.run", {
        command: "docker",
        args: [...globalFlags(app.context()), "exec", "-it", "--", ref, ...command],
        title: `${name}: ${command[0]}`,
      });
    } catch (error) {
      if (codeOf(error) === "unknown_command" || codeOf(error) === "permission_denied")
        throw new Error("Turn on the Terminal plugin to open a shell in a container.");
      throw error;
    }
  };

  /** Open a Compose project's first file on the desk. */
  const openFile = async (/** @type {Args} */ args = {}) => {
    const item = view.selection();
    const name =
      args.project !== undefined
        ? projectName(args.project)
        : item?.kind === "project"
          ? item.name
          : undefined;
    if (name === undefined) throw new Error("Select a Compose project, or name one with project.");
    const model = app.model("compose") ?? (await app.load("compose"));
    const project = /** @type {{ name: string, files: string[] }[]} */ (model.projects).find(
      (p) => p.name === name,
    );
    const file = project?.files[0];
    if (!file) throw new Error(`Compose does not say where ${name}'s files are.`);
    await commands.run("desk.files.open", { path: file });
    return file;
  };

  /** Talk to another context: the one named, or the one picked; "" is the CLI's current. */
  const switchContext = async (/** @type {Args} */ args = {}) => {
    let name = typeof args.name === "string" ? args.name : undefined;
    if (name === undefined) {
      const model = app.model("system") ?? (await app.load("system"));
      const items = [
        {
          id: CONTEXT_DEFAULT,
          label: "The CLI's current context",
          detail: "docker context use decides",
        },
        ...model.contexts.map((/** @type {import("./parse-engine.js").Context} */ c) => ({
          id: c.name,
          label: c.name === app.context() ? `${c.name} (in use here)` : c.name,
          detail: [c.description, c.endpoint].filter(Boolean).join(" · "),
        })),
      ];
      const picked = await app.pick("Docker: which context?", items);
      if (picked === undefined || picked === "") return app.context();
      name = picked === CONTEXT_DEFAULT ? "" : picked;
    }
    const used = await app.useContext(name);
    app.say(used ? `Using the context ${used}.` : "Using the CLI's current context.");
    return used;
  };

  /** Ask for words to filter the logs by; empty shows every line. */
  const filter = async () => {
    const text = await app.pick("Docker: show log lines with", [], true, "words, any case");
    if (text !== undefined) app.setFilter(text);
  };

  /** Stop following while it follows; follow again from the tail otherwise. */
  const toggleFollow = () => {
    const { follow, running } = app.logs.model();
    return app.logs.setFollow(!(follow && running));
  };

  /**
   * Answer a command. A failure goes to the status line and ends the command with the same words,
   * which the desk shows in its own notice.
   * @param {string} name
   * @param {(args: Args) => unknown} handler
   */
  const answer = (name, handler) =>
    commands.on(name, async (args) => {
      try {
        return await handler(/** @type {Args} */ (args ?? {}));
      } catch (error) {
        if (!codeOf(error)) app.say(error instanceof Error ? error.message : String(error));
        throw error;
      }
    });

  answer("endue.docker.open", async ({ view: name }) => {
    const target =
      typeof name === "string" && /** @type {readonly string[]} */ (LISTS).includes(name)
        ? /** @type {ListName} */ (name)
        : app.back();
    await app.showList(target);
    return target;
  });
  answer("endue.docker.refresh", () => app.refresh());
  answer("endue.docker.containers", containers);
  answer("endue.docker.compose", async () => (await list("compose")).projects);
  answer("endue.docker.images", async () => (await list("images")).images);
  answer("endue.docker.volumes", async () => (await list("volumes")).volumes);
  answer("endue.docker.networks", async () => (await list("networks")).networks);
  answer("endue.docker.system", () => list("system"));
  answer("endue.docker.start", actions.start);
  answer("endue.docker.stop", actions.stop);
  answer("endue.docker.restart", actions.restart);
  answer("endue.docker.pause", actions.pause);
  answer("endue.docker.unpause", actions.unpause);
  answer("endue.docker.kill", actions.kill);
  answer("endue.docker.remove", actions.remove);
  answer("endue.docker.logs", app.openLogs);
  answer("endue.docker.tail", app.tail);
  answer("endue.docker.inspect", app.inspect);
  answer("endue.docker.stats", async () => [...(await app.stats()).values()]);
  answer("endue.docker.shell", shell);
  answer("endue.docker.run", actions.run);
  answer("endue.docker.pull", actions.pull);
  answer("endue.docker.remove-image", actions.removeImage);
  answer("endue.docker.prune-images", actions.pruneImages);
  answer("endue.docker.remove-volume", actions.removeVolume);
  answer("endue.docker.prune-volumes", actions.pruneVolumes);
  answer("endue.docker.remove-network", actions.removeNetwork);
  answer("endue.docker.prune-networks", actions.pruneNetworks);
  answer("endue.docker.up", actions.up);
  answer("endue.docker.down", actions.down);
  answer("endue.docker.compose-start", actions.composeStart);
  answer("endue.docker.compose-stop", actions.composeStop);
  answer("endue.docker.compose-restart", actions.composeRestart);
  answer("endue.docker.compose-pull", actions.composePull);
  answer("endue.docker.open-file", openFile);
  answer("endue.docker.prune", actions.pruneSystem);
  answer("endue.docker.context", switchContext);
  answer("endue.docker.cancel", () => actions.cancel());
  registerSchemas(bridge);

  // The desk shows one of this plugin's buffers, or tells it one was closed (already decided).
  commands.on("desk.buffers.show", (args) => {
    const key = app.viewOf(args);
    void app.guard(() => (key ? app.reveal(key) : app.showList(app.back())))();
  });
  commands.on("desk.buffers.closed", (args) => {
    const key = app.viewOf(args);
    if (!key) return;
    const showing = app.current() === key;
    app.forget(key);
    if (showing) void app.guard(app.showList)(app.back());
  });

  const g = app.guard;
  /** @type {Record<string, (...args: unknown[]) => unknown>} */
  const keys = {
    ...Object.fromEntries(Object.entries(actions).map(([name, fn]) => [name, g(fn)])),
    ...Object.fromEntries(LISTS.map((name) => [name, g(() => app.showList(name))])),
    refresh: g(() => app.refresh()),
    toggleAll: g(() => app.toggleAll()),
    logs: g(() => app.openLogs()),
    inspect: g(() => app.inspect()),
    shell: g(() => shell()),
    openFile: g(() => openFile()),
    switchContext: g(() => switchContext()),
    toggleFollow: g(toggleFollow),
    toggleTimestamps: () => app.toggleTimestamps(),
    filter: g(filter),
    clearLogs: () => app.logs.clear(),
    back: g(() => app.showList(app.back())),
    help: () => app.say(hints(app.current())),
  };
  return keys;
}

/** The bridge or command code an error carries, if any. */
const codeOf = (/** @type {unknown} */ error) => /** @type {{ code?: string }} */ (error)?.code;
