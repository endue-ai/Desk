// The detail pane beside a list: a container (Info, Logs, Stats, Env, Ports, Inspect, Files), a
// Compose project's logs, an image (Info, History) or the output of a pull or a build. It holds what
// the pane shows and reads it; docker.js decides where the focus is and which buffer is open.

import { stripAnsi } from "./errors.js";
import {
  containerPath,
  copyInCommand,
  copyOutCommand,
  localPath,
  lsArgs,
  lsProblem,
  parseLs,
} from "./files.js";
import { historyArgs, imageInfo, parseHistory } from "./images.js";
import { detailExtras, firstOf, inspectModel } from "./inspect.js";
import { imageRef, objectRef } from "./refs.js";

/**
 * @typedef {import("./actions.js").Item} Item
 * @typedef {import("./inspect.js").Detail & ReturnType<typeof detailExtras>} FullDetail
 * @typedef {{ path: string, entries: import("./files.js").Entry[], problem: string,
 *   loading: boolean }} Files
 * @typedef {{ done: number, total: number, status: string }} Progress
 * @typedef {{ lines: string[], state: "running" | "done" | "failed", progress: Progress,
 *   error: string }} Op
 * @typedef {{ kind: "container" | "project" | "image" | "op", key: string, title: string,
 *   subtitle: string, state: string, tab: string, tabs: readonly string[], item?: Item,
 *   detail?: FullDetail | null, files?: Files | null,
 *   image?: { ref: string, info: import("./images.js").ImageInfo,
 *     layers: import("./images.js").Layer[] },
 *   op?: Op }} PaneModel
 * @typedef {{ feed(line: string): Progress & { error?: string } }} Tracker
 */

export const TABS = /** @type {const} */ ({
  container: ["info", "logs", "stats", "env", "ports", "json", "files"],
  project: ["logs"],
  image: ["info", "history"],
  op: ["output"],
});

/** The lines an operation's output keeps. */
const OP_LINES = 5000;
/** The output pane is drawn again at most this often while lines come. */
const OP_DRAW_MS = 100;

const messageOf = (/** @type {unknown} */ error) =>
  error instanceof Error ? error.message : String(error);

/**
 * @param {object} deps
 * @param {(args: string[], options?: import("./run.js").RunOptions) => Promise<import("./run.js").Outcome>} deps.docker
 * @param {{ pane(model: PaneModel | null): void }} deps.view
 * @param {() => import("./settings.js").Settings} deps.settings
 * @param {import("./watch.js").Clock} deps.clock
 * @param {() => void} deps.changed The pane opened, closed or changed what it is about.
 */
export function createPane(deps) {
  /** @type {PaneModel | null} */
  let model = null;
  let ops = 0;

  const publish = () => {
    deps.view.pane(model ? { ...model } : null);
    deps.changed();
  };

  /** A container's pane for `item`, keeping what it read when it is the same container. */
  const container = (/** @type {Extract<Item, { kind: "container" }>} */ item, tab = "info") => {
    const same =
      model?.kind === "container" && model.item?.kind === "container" && model.item.id === item.id;
    model = {
      kind: "container",
      key: `container:${item.id}`,
      title: item.name,
      subtitle: same ? (model?.subtitle ?? "") : "",
      state: item.state || (same ? (model?.state ?? "") : ""),
      tab: /** @type {readonly string[]} */ (TABS.container).includes(tab) ? tab : "info",
      tabs: TABS.container,
      item,
      detail: same ? (model?.detail ?? null) : null,
      files: same ? (model?.files ?? null) : null,
    };
    return model;
  };

  /** Read a container's detail; the pane shows it when it is about that container. */
  const loadDetail = async (/** @type {string} */ ref) => {
    const { stdout } = await deps.docker(["container", "inspect", "--", ref]);
    const json = firstOf(stdout);
    if (!json) throw new Error(`docker said nothing about ${ref}.`);
    const reveal = deps.settings().revealEnv;
    /** @type {FullDetail} */
    const detail = { ...inspectModel(json, { reveal }), ...detailExtras(json, { reveal }) };
    return detail;
  };

  /** Show a detail in the pane, on `tab`. */
  const showDetail = (/** @type {FullDetail} */ detail, tab = model?.tab ?? "info") => {
    const item = /** @type {const} */ ({
      kind: "container",
      id: detail.id,
      name: detail.name,
      state: detail.state,
      project: detail.project,
    });
    const pane = container(item, tab);
    model = { ...pane, subtitle: detail.image, state: detail.state, detail };
    publish();
    return model;
  };

  /** A folder of the pane's container, listed with its own ls; a failure is said in the tab. */
  const listFiles = async (/** @type {unknown} */ path) => {
    if (model?.kind !== "container" || model.item?.kind !== "container")
      throw new Error("Open a container first.");
    const id = model.item.id;
    const at = containerPath(path);
    model = {
      ...model,
      tab: "files",
      files: { path: at, entries: model.files?.entries ?? [], problem: "", loading: true },
    };
    publish();
    /** @type {Files} */
    let files;
    try {
      const { stdout } = await deps.docker(lsArgs(id, at));
      files = { path: at, entries: parseLs(stdout, at), problem: "", loading: false };
    } catch (error) {
      files = { path: at, entries: [], problem: lsProblem(messageOf(error)), loading: false };
    }
    if (model?.kind === "container" && model.item?.kind === "container" && model.item.id === id) {
      model = { ...model, files };
      publish();
    }
    return files.entries;
  };

  /** The container a copy is about: named, or the one in the pane. */
  const copyTarget = (/** @type {Record<string, unknown>} */ args) => {
    if (args.container !== undefined) return objectRef(args.container);
    if (model?.item?.kind === "container") return model.item.id;
    throw new Error("Open a container, or name one with container.");
  };

  /** Whether the pane lists files of `ref`, so a copy in can list them again. */
  const listing = (/** @type {string} */ ref) =>
    model?.kind === "container" &&
    model.item?.kind === "container" &&
    (model.item.id === ref || model.item.name === ref) &&
    model.files
      ? model.files.path
      : undefined;

  return {
    model: () => model,
    kind: () => model?.kind,
    item: () => model?.item,
    /** The container the pane is about, if any. */
    containerId: () =>
      model?.kind === "container" && model.item?.kind === "container" ? model.item.id : undefined,
    container: (/** @type {Extract<Item, { kind: "container" }>} */ item, tab = "info") => {
      container(item, tab);
      publish();
    },
    project: (/** @type {string} */ name, /** @type {string[]} */ files = []) => {
      model = {
        kind: "project",
        key: `project:${name}`,
        title: name,
        subtitle: "Compose project",
        state: "",
        tab: "logs",
        tabs: TABS.project,
        item: { kind: "project", name, files },
      };
      publish();
    },
    loadDetail,
    showDetail,
    /** Choose a tab; true when the pane has it. */
    tab(/** @type {string} */ name) {
      if (!model || !(/** @type {readonly string[]} */ (model.tabs).includes(name))) return false;
      model = { ...model, tab: name };
      publish();
      return true;
    },
    close() {
      if (!model) return;
      model = null;
      publish();
    },
    listFiles,

    /** An image's pane: what it runs and its layers. @param {Record<string, unknown>} args */
    async image(args, /** @type {Item | undefined} */ selected, tab = "info") {
      let ref;
      /** @type {Item} */
      let item;
      if (args.image !== undefined) {
        ref = imageRef(args.image);
        item = { kind: "image", id: "", ref, dangling: false, containers: null };
      } else if (selected?.kind === "image") {
        ref = selected.dangling ? selected.id : selected.ref;
        item = selected;
      } else throw new Error("Select an image, or name one with image.");
      const [inspected, history] = await Promise.all([
        deps.docker(["image", "inspect", "--", ref]),
        deps.docker(historyArgs(ref)),
      ]);
      const info = imageInfo(firstOf(inspected.stdout));
      const layers = parseHistory(history.stdout);
      model = {
        kind: "image",
        key: `image:${ref}`,
        title: selected?.kind === "image" && selected.dangling ? "<none>" : ref,
        subtitle: [info.os, info.arch].filter(Boolean).join("/"),
        state: "",
        tab,
        tabs: TABS.image,
        item: item.kind === "image" && item.id === "" ? { ...item, id: info.id } : item,
        image: { ref, info, layers },
      };
      publish();
      return layers;
    },

    /**
     * Show an operation's output as it comes; the pane keeps it while it shows that operation.
     * @param {string} title
     * @param {Tracker} tracker
     */
    track(title, tracker) {
      const key = `op:${++ops}`;
      /** @type {Op} */
      const op = {
        lines: [],
        state: "running",
        progress: { done: 0, total: 0, status: "" },
        error: "",
      };
      /** @type {ReturnType<typeof setTimeout> | null} */
      let timer = null;
      const draw = () => {
        timer = null;
        if (model?.key !== key) return;
        model = { ...model, state: op.state, op: { ...op, lines: [...op.lines] } };
        publish();
      };
      model = {
        kind: "op",
        key,
        title,
        subtitle: "",
        state: "running",
        tab: "output",
        tabs: TABS.op,
        op: { ...op },
      };
      publish();
      return {
        line: (/** @type {string} */ _stream, /** @type {string} */ raw) => {
          const text = stripAnsi(raw);
          op.lines.push(text);
          if (op.lines.length > OP_LINES) op.lines.shift();
          const { error, ...progress } = tracker.feed(text);
          op.progress = progress;
          if (error) op.error = error;
          if (timer === null) timer = deps.clock.setTimeout(draw, OP_DRAW_MS);
        },
        end: (/** @type {"done" | "failed"} */ state, error = "") => {
          if (timer !== null) deps.clock.clearTimeout(timer);
          op.state = state;
          if (error) op.error = error;
          draw();
        },
      };
    },

    /** Copy a path of a container out to a folder of this computer (`~/…` too). */
    async copyOut(/** @type {Record<string, unknown>} */ args, /** @type {string} */ dest) {
      const ref = copyTarget(args);
      const path = containerPath(args.path);
      const { args: argv, cwd } = copyOutCommand(ref, path, dest);
      await deps.docker(argv, { timeoutMs: 0, ...(cwd ? { cwd } : {}) });
      return `Copied ${path} to ${localPath(dest).shown}.`;
    },

    /**
     * Copy a file or folder of this computer into a folder of a container; the Files tab lists
     * again. `into` makes docker refuse a folder that is not there (files.js).
     */
    async copyIn(
      /** @type {Record<string, unknown>} */ args,
      /** @type {string} */ source,
      into = false,
    ) {
      const ref = copyTarget(args);
      const path = containerPath(args.path ?? listing(ref) ?? "/");
      const { args: argv, cwd } = copyInCommand(source, ref, path, into);
      await deps.docker(argv, { timeoutMs: 0, ...(cwd ? { cwd } : {}) });
      const shown = listing(ref);
      if (shown !== undefined) await listFiles(shown);
      return `Copied ${localPath(source).shown} into ${path}.`;
    },
    /** The folder the Files tab shows, for a copy in that names none. */
    folder: () => (model?.kind === "container" ? model.files?.path : undefined),
  };
}
