// The Git plugin without its DOM: which repository is open, the status, log and diff views and the
// desk buffers they are, the plugin's commands (endue.git.*) and the desk's requests. It talks only
// to ctx.bridge, ctx.commands, ctx.state and a view, so the SDK's test host runs it with a recording
// view and a scripted git.

import { createActions } from "./actions.js";
import { hints } from "./keys.js";
import { parseDiff } from "./parse-diff.js";
import { LOG_FORMAT, layoutGraph, parseLog } from "./parse-log.js";
import {
  emptyStatus,
  parseRecent,
  parseStashes,
  parseStatus,
  RECENT_FORMAT,
  STASH_FORMAT,
} from "./parse-status.js";
import { createRunner } from "./run.js";
import { DEFAULTS, loadSettings } from "./settings.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("./parse-status.js").StatusModel} StatusModel
 * @typedef {import("./parse-status.js").Stash} Stash
 * @typedef {import("./parse-status.js").RecentCommit} RecentCommit
 * @typedef {import("./parse-log.js").Commit} Commit
 * @typedef {import("./parse-log.js").Row} Row
 * @typedef {import("./parse-diff.js").DiffFile} DiffFile
 * @typedef {import("./actions.js").Item} Item
 * @typedef {import("./actions.js").CommitEditor} CommitEditor
 * @typedef {import("./keys.js").ViewName} ViewName
 * @typedef {{ root: string, name: string }} Repo
 * @typedef {{ repo: Repo | null, branch: string | null, upstream: string | null, ahead: number, behind: number, oid: string | null }} Header
 * @typedef {{ status: StatusModel, stashes: Stash[], recent: RecentCommit[] }} StatusView
 * @typedef {{ commits: Commit[], rows: Row[], more: boolean, all: boolean }} LogView
 * @typedef {{ staged?: boolean, path?: string, sha?: string }} DiffTarget
 * @typedef {{ title: string, files: DiffFile[], target: DiffTarget }} DiffView
 * @typedef {{
 *   header(header: Header): void,
 *   show(view: ViewName, hints: string): void,
 *   status(model: StatusView): void,
 *   log(model: LogView): void,
 *   diff(model: DiffView): void,
 *   commit(editor: CommitEditor | null): void,
 *   say(text: string): void,
 *   busy(running: number): void,
 *   focus(): void,
 *   selection(): Item | undefined,
 * }} View
 */

const RECENT_KEY = "recent";

/**
 * @param {Pick<PluginContext, "bridge" | "commands" | "state">} ctx
 * @param {View} view
 * @param {{ runner?: ReturnType<typeof createRunner>, cancelled?(message: string): Error }} [options]
 *   `cancelled` makes the error a cancelled command answers with (the SDK's CommandFailed).
 */
export function createGit({ bridge, commands, state }, view, options = {}) {
  const runner =
    options.runner ?? createRunner(bridge, { onBusy: (running) => view.busy(running) });
  let settings = DEFAULTS;
  /** @type {Repo | null} */
  let repo = null;
  /** @type {ViewName} */
  let current = "status";
  /** @type {StatusView} */
  let statusView = { status: emptyStatus(), stashes: [], recent: [] };
  /** @type {LogView | null} */
  let logView = null;
  /** @type {DiffView | null} */
  let diffView = null;
  /** The desk buffer each extra view is, once opened. @type {Map<"log" | "diff", string>} */
  const buffers = new Map();
  let said = "";

  const say = (/** @type {string} */ text) => {
    if (text === said) return;
    said = text;
    view.say(text);
  };

  const opened = () => {
    if (!repo) throw new Error("No repository is open: run Git: status with a folder.");
    return repo;
  };

  /** @param {string[]} args @param {import("./run.js").RunOptions} [runOptions] */
  const git = (args, runOptions = {}) => runner.run(args, { cwd: opened().root, ...runOptions });

  /** @type {import("./actions.js").Deps["pick"]} */
  const pick = async (title, items, free = false, placeholder = "") => {
    try {
      const picked = await commands.run("desk.palette.pick", {
        title,
        items,
        ...(free ? { free, placeholder } : {}),
      });
      return typeof picked === "string" && picked !== "" ? picked : undefined;
    } catch (error) {
      if (codeOf(error) === "cancelled") return undefined;
      throw new Error("Cannot ask: the palette is off.");
    }
  };

  const show = (/** @type {ViewName} */ name) => {
    current = name;
    view.show(name, hints(name));
    view.focus();
    state.set({ root: repo?.root ?? null, view: name });
  };

  const header = () => {
    const { branch, upstream, ahead, behind, oid } = statusView.status.head;
    view.header({ repo, branch, upstream, ahead, behind, oid });
  };

  const refreshStatus = async () => {
    const [status, stashes, recent] = await Promise.all([
      git(["status", "--porcelain=v2", "--branch", "-z"]),
      git(["stash", "list", `--format=${STASH_FORMAT}`]),
      // A repository without commits has no log yet: that is not an error here.
      git(["log", "-n", "10", `--format=${RECENT_FORMAT}`], { ok: [128] }),
    ]);
    statusView = {
      status: parseStatus(status.stdout),
      stashes: parseStashes(stashes.stdout),
      recent: recent.code === 0 ? parseRecent(recent.stdout) : [],
    };
    header();
    view.status(statusView);
  };

  const remotes = async () =>
    (await git(["remote"])).stdout.split("\n").filter((line) => line !== "");

  /** @param {{ all: boolean, skip: number }} what */
  const loadLog = async ({ all, skip }) => {
    const count = settings.logCount;
    const [names, log] = await Promise.all([
      remotes(),
      git([
        "log",
        "--topo-order",
        `--max-count=${count}`,
        ...(skip > 0 ? [`--skip=${skip}`] : []),
        `--format=${LOG_FORMAT}`,
        ...(all ? ["--all"] : ["HEAD"]),
        "--",
      ]),
    ]);
    const loaded = parseLog(log.stdout, names);
    const commits = skip > 0 && logView ? [...logView.commits, ...loaded] : loaded;
    logView = { commits, rows: layoutGraph(commits), more: loaded.length === count, all };
    view.log(logView);
  };

  /** Each extra view is a desk buffer, so Mod+B and the buffer list reach it. */
  const buffer = async (/** @type {"log" | "diff"} */ key, /** @type {string} */ name) => {
    if (buffers.has(key)) {
      await commands.run("desk.buffers.update", { id: buffers.get(key), name }).catch(() => {});
      return;
    }
    const id = await commands.run("desk.buffers.open", { name }).catch(() => undefined);
    if (typeof id === "string") buffers.set(key, id);
  };

  /** @param {{ all?: boolean }} [args] */
  const showLog = async (args) => {
    const all = args?.all ?? logView?.all ?? false;
    await loadLog({ all, skip: 0 });
    await buffer("log", `git log: ${opened().name}${all ? " (all)" : ""}`);
    show("log");
  };

  const more = async () => {
    if (!logView?.more) return;
    await loadLog({ all: logView.all, skip: logView.commits.length });
  };

  /** What `d` or Git: diff shows for a selection: the file's changes, a commit, or the staged set. */
  const targetOf = (/** @type {DiffTarget | undefined} */ args) => {
    if (args && (args.staged || args.path || args.sha)) return args;
    const item = view.selection();
    if (item?.kind === "file") {
      if (item.section === "untracked") throw new Error("An untracked file has no diff: stage it.");
      return { path: item.path, staged: item.section === "staged" };
    }
    if (item?.kind === "commit") return { sha: item.sha };
    if (item?.kind === "section" && item.section === "staged") return { staged: true };
    return {};
  };

  /** @param {DiffTarget} target */
  const loadDiff = async (target) => {
    const context = `-U${settings.diffContext}`;
    const args = target.sha
      ? ["show", "--format=", context, target.sha, "--"]
      : [
          "diff",
          ...(target.staged ? ["--cached"] : []),
          context,
          "--",
          ...(target.path ? [target.path] : []),
        ];
    const { stdout } = await git(args);
    const title = target.sha
      ? target.sha.slice(0, 7)
      : `${target.staged ? "staged" : "unstaged"}${target.path ? ` ${target.path}` : ""}`;
    diffView = { title, files: parseDiff(stdout), target };
    view.diff(diffView);
  };

  /** @param {DiffTarget} [args] */
  const showDiff = async (args) => {
    await loadDiff(targetOf(args));
    await buffer("diff", `git diff: ${diffView?.title ?? ""}`);
    show("diff");
  };

  const refresh = async () => {
    opened();
    await refreshStatus();
    if (current === "log" && logView) await loadLog({ all: logView.all, skip: 0 });
    if (current === "diff" && diffView) await loadDiff(diffView.target);
  };

  /** The repositories opened before, most recent first, from the plugin's store. */
  const recentRepos = async () => {
    const kept = await bridge.call("store.get", { key: RECENT_KEY }).catch(() => ({}));
    return Array.isArray(kept.value) ? kept.value.filter((v) => typeof v === "string") : [];
  };

  const remember = async (/** @type {string} */ root) => {
    const list = await recentRepos();
    const next = [root, ...list.filter((path) => path !== root)].slice(0, settings.recentMax);
    await bridge.call("store.set", { key: RECENT_KEY, value: next }).catch(() => {});
  };

  const pickRepo = async () => {
    const items = (await recentRepos()).map((p) => ({ id: p, label: nameOf(p), detail: p }));
    return pick("Git: which repository?", items, true, "a folder path");
  };

  /**
   * Open the repository `path` is in (or the one picked), then show its status.
   * @param {string} [path]
   */
  const open = async (path) => {
    const chosen = path ?? (await pickRepo());
    if (chosen === undefined) return null;
    const top = await runner
      .run(["rev-parse", "--show-toplevel"], { cwd: chosen })
      .catch((/** @type {Error & { outcome?: { code?: number | null } }} */ error) => {
        if (error.outcome?.code === 128) throw new Error(`Not a Git repository: ${chosen}.`);
        throw error;
      });
    const root = top.stdout.trim();
    repo = { root, name: nameOf(root) };
    logView = null;
    diffView = null;
    await remember(root);
    await refreshStatus();
    show("status");
    return root;
  };

  const actions = createActions({
    git,
    cancel: () => runner.cancel(),
    status: () => statusView.status,
    settings: () => settings,
    selection: () => view.selection(),
    refresh,
    say,
    pick,
    editor: (model) => {
      view.commit(model);
      if (model) show("commit");
      else show("status");
    },
    openFile: async (path) => {
      await commands.run("desk.files.open", { path: `${opened().root}/${path}` });
    },
    cancelled:
      options.cancelled ?? ((message) => Object.assign(new Error(message), { code: "cancelled" })),
  });

  /**
   * Answer a command or a request. A failure goes to the status line and ends the request with the
   * same words, which the desk shows in its own notice; a success clears the line.
   * @param {string} name
   * @param {(args: any) => unknown} handler
   */
  const answer = (name, handler) =>
    commands.on(name, async (args) => {
      try {
        const result = await handler(args ?? {});
        if (name !== "endue.git.commit") said = "";
        return result;
      } catch (error) {
        if (!codeOf(error)) say(error instanceof Error ? error.message : String(error));
        throw error;
      }
    });

  answer("endue.git.status", async ({ path }) => {
    if (typeof path === "string" && path !== "") return open(path);
    if (!repo) return open();
    await refreshStatus();
    show("status");
    return repo.root;
  });
  answer("endue.git.refresh", refresh);
  answer("endue.git.log", showLog);
  answer("endue.git.diff", showDiff);
  answer("endue.git.stage", actions.stage);
  answer("endue.git.unstage", actions.unstage);
  answer("endue.git.discard", actions.discard);
  answer("endue.git.commit", actions.commit);
  answer("endue.git.fetch", actions.fetch);
  answer("endue.git.pull", actions.pull);
  answer("endue.git.push", actions.push);
  answer("endue.git.checkout", actions.checkout);
  answer("endue.git.visit", actions.visit);
  answer("endue.git.cancel", () => actions.cancel());

  /** Which of this plugin's views a desk buffer id names. */
  const viewOf = (/** @type {unknown} */ args) => {
    const id = /** @type {{ buffer?: string } | undefined} */ (args)?.buffer;
    return [...buffers].find(([, value]) => value === id)?.[0];
  };
  // The desk shows one of this plugin's buffers, or tells it one was closed.
  commands.on("desk.buffers.show", (args) => show(viewOf(args) ?? "status"));
  commands.on("desk.buffers.closed", (args) => {
    const key = viewOf(args);
    if (!key) return;
    buffers.delete(key);
    if (key === "log") logView = null;
    else diffView = null;
    if (current === key) show("status");
  });

  /** The view's single keys and buttons: a failure is said, never thrown at the DOM. */
  const guard =
    (/** @type {(...args: any[]) => unknown} */ fn) =>
    async (/** @type {unknown[]} */ ...args) => {
      try {
        await fn(...args);
        said = "";
      } catch (error) {
        if (codeOf(error) === "cancelled") return;
        say(error instanceof Error ? error.message : String(error));
      }
    };

  const ready = (async () => {
    // Read what a reload handed back before show() saves the state anew.
    const saved = /** @type {{ root?: string | null, view?: ViewName } | undefined} */ (
      state.get()
    );
    settings = await loadSettings(bridge);
    header();
    view.status(statusView);
    show("status");
    if (saved?.root) {
      await guard(open)(saved.root);
      if (saved.view === "log") await guard(showLog)();
    }
  })();

  /** Every action guarded, for the view's keys. */
  const guarded =
    /** @type {{ [K in keyof typeof actions]: (...args: unknown[]) => Promise<void> }} */ (
      Object.fromEntries(Object.entries(actions).map(([name, fn]) => [name, guard(fn)]))
    );

  return {
    ready,
    ...guarded,
    open: guard(open),
    refresh: guard(refresh),
    status: () => show("status"),
    log: guard(showLog),
    toggleAll: guard(() => showLog({ all: !(logView?.all ?? false) })),
    more: guard(more),
    diff: guard(showDiff),
    help: () => say(hints(current)),
  };
}

/** The last segment of a path: `/Users/me/Project/Desk` → `Desk`. */
export function nameOf(/** @type {string} */ path) {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1) || trimmed;
}

/** The bridge or command code an error carries, if any. */
const codeOf = (/** @type {unknown} */ error) => /** @type {{ code?: string }} */ (error)?.code;
