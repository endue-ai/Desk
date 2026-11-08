// What the controller does with the detail pane (pane.js holds what it shows): open a container's
// detail or a target's logs in it as desk buffers, switch its tabs, read its container again when
// the engine says it changed, and bring back a buffer the desk shows. No DOM.

import { readLogs, titleOf } from "./logs.js";
import { containerTarget, logTarget } from "./refs.js";

/**
 * @typedef {import("./docker.js").View} View
 * @typedef {import("./docker.js").ListName} ListName
 * @typedef {import("./keys.js").ViewName} ViewName
 * @typedef {import("./logs.js").LogTarget} LogTarget
 * @typedef {import("./pane.js").FullDetail} FullDetail
 * @typedef {Record<string, unknown>} Args
 */

const messageOf = (/** @type {unknown} */ error) =>
  error instanceof Error ? error.message : String(error);

/**
 * @param {object} deps
 * @param {ReturnType<typeof import("./pane.js").createPane>} deps.pane
 * @param {View} deps.view
 * @param {ReturnType<typeof import("./logs.js").createLogs>} deps.logs
 * @param {(args: string[], options?: import("./run.js").RunOptions) => Promise<import("./run.js").Outcome>} deps.docker
 * @param {() => import("./settings.js").Settings} deps.settings
 * @param {(key: "logs" | "inspect", name: string) => Promise<void>} deps.buffer
 * @param {(name: ViewName) => void} deps.show
 * @param {(name: ListName) => Promise<unknown>} deps.showList
 * @param {() => void} deps.save
 * @param {(text: string) => void} deps.say
 * @param {() => ViewName} deps.current
 * @param {() => ListName} deps.back
 * @param {() => void} deps.resetFilter
 */
export function createPaneControl(deps) {
  const { pane, view, logs } = deps;
  /** The detail the inspect buffer shows. @type {FullDetail | null} */
  let detail = null;

  const inPane = () => deps.current() === "inspect" || deps.current() === "logs";

  /** The container in the pane, which commands fall back to while the pane has the focus. */
  const shown = () => {
    const item = pane.item();
    return inPane() && item?.kind === "container" ? { id: item.id, name: item.name } : null;
  };
  /** What actions work on: the row under the cursor, or in the pane what the pane is about. */
  const selection = () => (inPane() && pane.item() ? pane.item() : view.selection());

  /** Show a target's logs in the pane, following them unless `follow` is false. */
  const logsOf = async (/** @type {LogTarget} */ target, /** @type {Args} */ args = {}) => {
    const settings = deps.settings();
    const follow = typeof args.follow === "boolean" ? args.follow : settings.follow;
    const tail = Number.isInteger(args.tail) ? Number(args.tail) : settings.logTail;
    deps.resetFilter();
    await deps.buffer("logs", titleOf(target));
    const item = selection();
    if (target.kind === "container") {
      const same = item?.kind === "container" && item.id === target.id;
      const { id, name } = target;
      const state = same ? item.state : "";
      pane.container(
        { kind: "container", id, name, state, project: same ? item.project : "" },
        "logs",
      );
    } else pane.project(target.name, item?.kind === "project" ? item.files : []);
    deps.show("logs");
    await logs.open(target, { follow, tail });
    deps.save();
    return { title: titleOf(target), follow };
  };

  /** A container's detail in the pane, on `tab`. */
  const inspect = async (/** @type {Args} */ args = {}, tab = "info") => {
    const { ref } = containerTarget(args, selection(), shown());
    detail = await pane.loadDetail(ref);
    view.detail(detail);
    pane.showDetail(detail, tab);
    await deps.buffer("inspect", `docker inspect: ${detail.name}`);
    deps.show("inspect");
    return detail;
  };

  return {
    detail: () => detail,
    shown,
    selection,
    /** @param {Args} [args] `follow` and `tail` override the settings. */
    openLogs: (args = {}) => logsOf(logTarget(args, selection(), shown()), args),
    /** The logs a reload left, checked again, under the container's name when it had one. */
    restoreLogs(/** @type {LogTarget} */ saved) {
      const args = saved.kind === "project" ? { project: saved.name } : { container: saved.id };
      const target = logTarget(args, undefined, null);
      const name =
        typeof saved.name === "string" && /^[\w][\w.-]*$/.test(saved.name) ? saved.name : "";
      return logsOf(target.kind === "container" && name ? { ...target, name } : target);
    },
    /** The last lines of a target's logs, for agents: no view, both streams in time order. */
    tail: async (/** @type {Args} */ args = {}) => ({
      lines: await readLogs({ run: deps.docker }, logTarget(args, view.selection(), shown()), args),
    }),
    inspect,

    /** Switch the pane's tab: Logs opens the logs, the others read what they show when needed. */
    async paneTab(/** @type {string} */ name) {
      const model = pane.model();
      if (!model?.tabs.includes(name)) return;
      const item = model.item;
      if (name === "logs" && item?.kind === "container")
        return void (await logsOf({ kind: "container", id: item.id, name: item.name }));
      if (name === "logs" && item?.kind === "project")
        return void (await logsOf({ kind: "project", name: item.name }));
      if (item?.kind === "container" && !model.detail) await inspect({ container: item.id }, name);
      else pane.tab(name);
      if (name === "files" && !pane.model()?.files) await pane.listFiles("/");
      deps.show("inspect");
    },

    /** Read the container in the pane again; when it is gone, close the pane and say so. */
    async reloadDetail() {
      const id = pane.containerId();
      if (!id) return;
      const name = pane.model()?.title ?? id;
      try {
        const fresh = await pane.loadDetail(id);
        if (pane.containerId() !== id) return;
        pane.showDetail(fresh);
        if (detail?.id === id) {
          detail = fresh;
          view.detail(fresh);
        }
      } catch (error) {
        if (!/no such container/i.test(messageOf(error))) throw error;
        if (detail?.id === id) {
          detail = null;
          view.detail(null);
        }
        pane.close();
        if (inPane()) await deps.showList(deps.back());
        deps.say(`${name} is gone.`);
      }
    },

    /** Show a buffer the desk asked for; one with nothing left in it shows the list instead. */
    async reveal(/** @type {"logs" | "inspect"} */ key) {
      const target = logs.model().target;
      if (key === "inspect" ? !detail : !target) return void (await deps.showList(deps.back()));
      if (key === "inspect" && detail) pane.showDetail(detail, "info");
      else if (target?.kind === "project") pane.project(target.name);
      else if (target) {
        const { id, name } = target;
        pane.container({ kind: "container", id, name, state: "", project: "" }, "logs");
      }
      deps.show(key);
    },

    /** The desk closed a buffer: the logs stop, or the detail is forgotten. */
    forget(/** @type {"logs" | "inspect"} */ key) {
      if (key === "logs") void logs.stop();
      else {
        detail = null;
        view.detail(null);
      }
    },
  };
}
