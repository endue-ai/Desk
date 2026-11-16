// What the buttons and menus do to containers and stacks: one docker call per object, asked first
// when it cannot be undone, said in a toast when done or failed, and the lists read again (the
// events stream would do it too; this is for an engine whose events lag).

import { objectRef, projectName } from "./refs.js";

/**
 * @typedef {import("./studio.js").App} App
 * @typedef {{ id: string, name: string, project?: string, state?: string }} Target
 * @typedef {"start" | "stop" | "restart" | "pause" | "unpause" | "kill" | "remove"} ContainerOp
 */

const PAST = /** @type {Record<ContainerOp, string>} */ ({
  start: "Started",
  stop: "Stopped",
  restart: "Restarted",
  pause: "Paused",
  unpause: "Resumed",
  kill: "Killed",
  remove: "Removed",
});

const plural = (/** @type {Target[]} */ list) =>
  list.length === 1 ? (list[0]?.name ?? "") : `${list.length} containers`;

/** @param {App} app */
export function createActions(app) {
  /** @type {Set<string>} */
  const busy = new Set();
  const say = (/** @type {unknown} */ error) =>
    app.toast(String(/** @type {any} */ (error)?.message ?? error), "danger");

  /** The args of one container operation. */
  const argsOf = (/** @type {ContainerOp} */ op, /** @type {Target} */ t) => {
    const ref = objectRef(t.id);
    const time = String(app.settings.stopTimeout);
    if (op === "remove") return ["container", "rm", "--force", "--", ref];
    if (op === "stop" || op === "restart") return ["container", op, "--time", time, "--", ref];
    return ["container", op, "--", ref];
  };

  /** Ask before what cannot be undone. */
  const sure = async (/** @type {ContainerOp} */ op, /** @type {Target[]} */ list) => {
    if (!app.settings.confirm || (op !== "remove" && op !== "kill")) return true;
    const running = list.filter((t) => t.state === "running").length;
    return app.overlay.confirm({
      title: op === "remove" ? `Remove ${plural(list)}?` : `Kill ${plural(list)}?`,
      text:
        op === "remove"
          ? `${running ? `${running === list.length ? "They run now and" : `${running} of them run now and`} stop first. ` : ""}Their files that are not in a volume go with them; named volumes stay.`
          : "They stop at once, without the time to shut down cleanly.",
      ok: op === "remove" ? "Remove" : "Kill",
      danger: true,
    });
  };

  /** Run one operation on some containers, one docker call each, side by side. */
  const container = async (/** @type {ContainerOp} */ op, /** @type {Target[]} */ list) => {
    if (list.length === 0 || !(await sure(op, list))) return false;
    const failed = [];
    await Promise.all(
      list.map(async (t) => {
        busy.add(t.id);
        app.store.touch("containers");
        try {
          await app.docker(argsOf(op, t), { timeoutMs: (app.settings.stopTimeout + 30) * 1000 });
        } catch (error) {
          failed.push(error);
        } finally {
          busy.delete(t.id);
        }
      }),
    );
    void app.engine.load("containers");
    if (failed.length) say(failed[0]);
    else app.toast(`${PAST[op]} ${plural(list)}.`, "success");
    return failed.length === 0;
  };

  /** Compose on a stack: by its name, with its files when an operation needs them. */
  const compose = async (
    /** @type {"start" | "stop" | "restart" | "down" | "up" | "pull"} */ op,
    /** @type {string} */ name,
  ) => {
    const project = projectName(name);
    const stack = app.stacks().find((s) => s.name === project);
    if (op === "down" && app.settings.confirm) {
      const yes = await app.overlay.confirm({
        title: `Take ${project} down?`,
        text: "Its containers stop and are removed, with the networks Compose made for it. Named volumes stay.",
        ok: "Take down",
        danger: true,
      });
      if (!yes) return false;
    }
    const files = (stack?.files ?? []).flatMap((f) => ["--file", f]);
    const needsFiles = op === "up" || op === "pull";
    if (needsFiles && files.length === 0) {
      app.toast(`${project} has no Compose file this engine knows of.`, "danger");
      return false;
    }
    const args = [
      "compose",
      "--ansi",
      "never",
      "--project-name",
      project,
      ...(needsFiles ? files : []),
      ...(op === "up" ? ["up", "--detach", "--remove-orphans"] : [op]),
    ];
    app.pending.add(project);
    app.store.touch("containers");
    try {
      await app.docker(args, { timeoutMs: 0, cwd: stack?.dir || undefined });
      const verbs = {
        start: "Started",
        stop: "Stopped",
        restart: "Restarted",
        down: "Took down",
        up: "Brought up",
        pull: "Pulled the images of",
      };
      app.toast(`${verbs[op]} ${project}.`, "success");
      return true;
    } catch (error) {
      say(error);
      return false;
    } finally {
      app.pending.delete(project);
      void app.engine.load("containers");
      void app.engine.load("projects");
    }
  };

  /** A shell in a running container, in the desk's terminal. */
  const shell = async (/** @type {Target} */ t) => {
    try {
      await app.ctx.commands.run("endue.terminal.run", {
        command: "docker",
        args: [
          ...(app.store.state.context ? ["--context", app.store.state.context] : []),
          "exec",
          "--interactive",
          "--tty",
          "--",
          objectRef(t.id),
          app.settings.shell,
        ],
        title: t.name,
      });
    } catch (error) {
      say(`Could not open a terminal: ${/** @type {any} */ (error)?.message ?? error}`);
    }
  };

  /** Open a URL (a published port) in the browser. */
  const browse = async (/** @type {string} */ url) => {
    try {
      await app.ctx.bridge.call("shell.open", {
        target: url,
        scope: { permission: "shell:open", schemes: ["http", "https"] },
      });
    } catch (error) {
      say(error);
    }
  };

  const copy = async (/** @type {string} */ text, /** @type {string} */ what) => {
    try {
      await navigator.clipboard.writeText(text);
      app.toast(`Copied ${what}.`, "success");
    } catch {
      app.toast(`Could not copy ${what}.`, "danger");
    }
  };

  /** Open a file (a Compose file, a Dockerfile) in the desk's editor. */
  const openFile = async (/** @type {string} */ path) => {
    try {
      await app.ctx.commands.run("desk.files.open", { path });
    } catch {
      app.toast(`Could not open ${path}.`, "danger");
    }
  };

  return { container, compose, shell, browse, copy, openFile, busy };
}
