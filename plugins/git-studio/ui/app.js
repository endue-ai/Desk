// Git Studio without its DOM: the open repository, the snapshot the window draws, what is selected,
// and the actions the views call. Views subscribe and redraw from `get()`; nothing here touches the
// document, so the SDK's test host runs it with a scripted git.

import { findRoot, loadCommit, loadSnapshot } from "./repo.js";
import { createRunner } from "./run.js";

/**
 * @typedef {import("@endue-ai/plugin-sdk").PluginContext} PluginContext
 * @typedef {import("./repo.js").Snapshot} Snapshot
 * @typedef {import("./repo.js").CommitDetail} CommitDetail
 * @typedef {"graph" | "diff" | "conflict" | "blame" | "history"} Center
 * @typedef {{ text: string, tone: "info" | "success" | "danger" }} Notice
 * @typedef {{
 *   repo: string | null, snapshot: Snapshot | null, loading: boolean, error: string | null,
 *   selected: string | null, detail: CommitDetail | null, center: Center, busy: number,
 *   notice: Notice | null, recent: string[], query: string, scope: "all" | "current",
 *   sidebar: boolean, limit: number, [key: string]: unknown,
 * }} State
 * @typedef {{ recent?: string[], repo?: string | null, scope?: "all" | "current", sidebar?: boolean }} Kept
 */

/** The WIP row's id in the graph: the working copy's changes above HEAD. */
export const WIP = "~wip";
const RECENT_MAX = 12;
const PAGE = 400;

/**
 * @param {Pick<PluginContext, "bridge" | "state">} ctx
 * @param {{ runner?: ReturnType<typeof createRunner> }} [options]
 */
export function createApp(ctx, options = {}) {
  const kept = /** @type {Kept} */ (ctx.state.get() ?? {});
  /** @type {State} */
  let state = {
    repo: null,
    snapshot: null,
    loading: false,
    error: null,
    selected: null,
    detail: null,
    center: "graph",
    busy: 0,
    notice: null,
    recent: kept.recent ?? [],
    query: "",
    searchMode: "text",
    deep: null,
    scope: kept.scope ?? "all",
    sidebar: kept.sidebar ?? true,
    limit: PAGE,
  };
  /** @type {Set<(state: State, previous: State) => void>} */
  const listeners = new Set();
  const git = options.runner ?? createRunner(ctx.bridge, { onBusy: (busy) => set({ busy }) });
  let loadSeq = 0;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let noticeTimer;

  /** @param {Partial<State>} patch */
  function set(patch) {
    const previous = state;
    state = { ...state, ...patch };
    for (const listener of listeners) listener(state, previous);
  }

  const keep = () =>
    ctx.state.set({
      recent: state.recent,
      repo: state.repo,
      scope: state.scope,
      sidebar: state.sidebar,
    });

  /** Say something on the status bar for a while. @param {string} text @param {Notice["tone"]} [tone] */
  function say(text, tone = "info") {
    if (noticeTimer !== undefined) clearTimeout(noticeTimer);
    set({ notice: { text, tone } });
    noticeTimer = setTimeout(() => set({ notice: null }), tone === "danger" ? 9000 : 4500);
  }

  /** Open the repository a path is in; it goes to the front of the recent list. */
  async function open(/** @type {string} */ path) {
    set({ loading: true, error: null });
    try {
      const root = await findRoot(git, path);
      const recent = [root, ...state.recent.filter((r) => r !== root)].slice(0, RECENT_MAX);
      set({ repo: root, recent, selected: null, detail: null, center: "graph", limit: PAGE });
      keep();
      await refresh();
      return root;
    } catch (error) {
      set({ loading: false, error: messageOf(error) });
      throw error;
    }
  }

  /** Read the repository again; the selection stays when its commit is still there. */
  async function refresh() {
    const root = state.repo;
    if (!root) return;
    const seq = ++loadSeq;
    set({ loading: true });
    try {
      const snapshot = await loadSnapshot(git, root, { limit: state.limit, scope: state.scope });
      if (seq !== loadSeq) return;
      const dirty = hasChanges(snapshot);
      let selected = state.selected;
      if (selected === WIP && !dirty) selected = null;
      if (selected && selected !== WIP && !snapshot.commits.some((c) => c.sha === selected))
        selected = null;
      if (selected === null)
        selected = dirty ? WIP : (snapshot.status.oid ?? snapshot.commits[0]?.sha ?? null);
      set({ snapshot, loading: false, error: null, selected });
      if (selected && selected !== WIP && state.detail?.sha !== selected) await select(selected);
    } catch (error) {
      if (seq === loadSeq) set({ loading: false, error: messageOf(error) });
    }
  }

  /** Select a commit (or the WIP row) and load what the right panel shows of it. */
  async function select(/** @type {string | null} */ sha) {
    set({ selected: sha, detail: sha === state.detail?.sha ? state.detail : null });
    if (!sha || sha === WIP || !state.repo) return;
    try {
      const detail = await loadCommit(git, state.repo, sha);
      if (state.selected === sha) set({ detail });
    } catch (error) {
      say(messageOf(error), "danger");
    }
  }

  /** Load the next page of the graph. */
  async function more() {
    set({ limit: state.limit + PAGE });
    await refresh();
  }

  return {
    git,
    get: () => state,
    set,
    say,
    keep,
    open,
    refresh,
    select,
    more,
    /** @param {(state: State, previous: State) => void} listener */
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Run a change to the repository: busy while it runs, said when it fails, read again after. */
    async act(
      /** @type {string} */ label,
      /** @type {() => Promise<unknown>} */ work,
      { quiet = false } = {},
    ) {
      try {
        const result = await work();
        if (!quiet) say(label, "success");
        return result;
      } catch (error) {
        say(messageOf(error), "danger");
        return undefined;
      } finally {
        await refresh();
      }
    },
    /** The last repository, from the plugin's kept state. */
    restore: () => kept.repo ?? null,
  };
}

/** @typedef {ReturnType<typeof createApp>} App */

/** Whether the working copy has anything to commit or resolve. */
export function hasChanges(/** @type {Snapshot} */ snapshot) {
  const { staged, unstaged, conflicts } = snapshot.status;
  return staged.length + unstaged.length + conflicts.length > 0;
}

export const messageOf = (/** @type {unknown} */ error) =>
  error instanceof Error ? error.message : String(error);
