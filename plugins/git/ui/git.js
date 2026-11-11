// The Git plugin without its DOM: which repository is open, the status, log and diff views and the
// desk buffers they are, the plugin's commands (endue.git.*), endue.git.state for agents, and the
// desk's requests. It talks only to ctx.bridge, ctx.commands, ctx.state and a view, so the SDK's
// test host runs it with a recording view and a scripted git.

import { createActions } from "./actions.js";
import { snapshot } from "./agent.js";
import { findBranches, listBranches } from "./branches.js";
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
import { createRecent, nameOf } from "./recent.js";
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
 * @typedef {{ repo: Repo | null, status: StatusModel, stashes: Stash[], recent: RecentCommit[] }} StatusView
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
  let statusView = { repo: null, status: emptyStatus(), stashes: [], recent: [] };
  /** @type {LogView | null} */
  let logView = null;
  /** @type {Promise<void> | null} */
  let loadingMore = null;
  /** @type {DiffView | null} */
  let diffView = null;
  /** The view a diff was opened from. @type {"status" | "log"} */
  let diffFrom = "status";
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
      repo,
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
    if (loadingMore) return loadingMore;
    if (!logView?.more) return;
    loadingMore = loadLog({ all: logView.all, skip: logView.commits.length });
    try {
      await loadingMore;
    } finally {
      loadingMore = null;
    }
  };
  /** What `d` or Git: diff shows for a selection: the file's changes, a commit, or the staged set. */
  const targetOf = (/** @type {DiffTarget | undefined} */ args) => {
    if (args && (args.staged || args.path || args.sha)) return args;
    const item = view.selection();
    if (current === "log" && item?.kind !== "commit") throw new Error("Select a commit");
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
    const from = current;
    await loadDiff(targetOf(args));
    await buffer("diff", `git diff: ${diffView?.title ?? ""}`);
    if (from !== "diff") diffFrom = from === "log" ? "log" : "status";
    show("diff");
  };
  /** `q` in a diff: back to the log it came from while that log is open, else the status. */
  const back = () => show(diffFrom === "log" && logView ? "log" : "status");
  const refresh = async () => {
    opened();
    await refreshStatus();
    if (current === "log" && logView) await loadLog({ all: logView.all, skip: 0 });
    if (current === "diff" && diffView) await loadDiff(diffView.target);
  };

  const { remember, pickRepo, last } = createRecent(bridge, () => settings.recentMax, pick);

  /** Open the repository `path` is in, or one picked; show its status. @param {string} [path] */
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
      show(model ? "commit" : "status");
    },
    openFile: async (path) => {
      await commands.run("desk.files.open", { path: `${opened().root}/${path}` });
    },
    cancelled:
      options.cancelled ?? ((message) => Object.assign(new Error(message), { code: "cancelled" })),
  });

  /**
   * Answer a command or a request, after the start (its repository open). A failure goes to the
   * status line and ends the request with the same words, which the desk shows in its own notice;
   * a success clears the line.
   * @param {string} name
   * @param {(args: any) => unknown} handler
   */
  const answer = (name, handler) =>
    commands.on(name, async (args) => {
      await ready;
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
  // What an agent reads (ADR 0088): the repository `path` is in, else the open one, as data.
  answer("endue.git.state", async ({ path }) => {
    if (typeof path === "string" && path !== "" && path !== repo?.root) await open(path);
    await refresh();
    return snapshot(opened(), statusView);
  });
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
    // A reload hands back what the surface had (read before show() saves it anew); a start of the
    // desk, which keeps no surface state, opens the repository opened last.
    const saved = /** @type {{ root?: string | null, view?: ViewName } | undefined} */ (
      state.get()
    );
    settings = await loadSettings(bridge);
    const root = saved ? saved.root : await last();
    if (root) {
      await guard(open)(root);
      if (repo && saved?.view === "log") await guard(showLog)();
    }
    if (repo) return;
    header();
    view.status(statusView);
    show("status");
  })();
  // The palette's Branches group, for the repository a reload brought back too. Asking is not an
  // operation: the status line neither says nor clears anything.
  commands.on("endue.git.branches", async (args) => {
    await ready;
    return findBranches(args, repo, () => listBranches(git), statusView.status.head.branch);
  });

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
    back,
    log: guard(showLog),
    toggleAll: guard(() => showLog({ all: !(logView?.all ?? false) })),
    more: guard(more),
    diff: guard(showDiff),
  };
}

/** The bridge or command code an error carries, if any. */
const codeOf = (/** @type {unknown} */ error) => /** @type {{ code?: string }} */ (error)?.code;
