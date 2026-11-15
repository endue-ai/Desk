// Coming back to the terminals, for sessions.js. After a reload or a closed window (TERM-S07) the
// programs still run in the core: each pane attaches to its process again, replays its tail and
// resizes, in the tabs and splits the snapshot kept. After a restart (issue 315) only the layout the store
// kept is left (keep.js): the same tabs and splits come back, each pane a fresh shell in its folder.
// With neither, one terminal opens. No DOM.
import { KEY, readKept } from "./keep.js";
import { leaf, panesOf } from "./layout.js";
import { decode } from "./output.js";
import { candidates } from "./shell.js";
import { blankSession, restoredSession } from "./snapshot.js";

/**
 * @typedef {import("./types.js").Session} Session
 * @typedef {import("./types.js").Snapshot} Snapshot
 * @typedef {import("./types.js").View} View
 * @typedef {import("./layout.js").Layout} Layout
 * @typedef {import("./keep.js").Kept} Kept
 * @typedef {import("./keep.js").KeptNode} KeptNode
 * @typedef {import("./keep.js").KeptPane} KeptPane
 */

/**
 * @param {{
 *   bridge: { call(method: "store.get", params: { key: string }): Promise<{ value?: unknown }> },
 *   sessions: Map<string, Session>, byProc: Map<string, string>,
 *   tabset: ReturnType<typeof import("./panes.js").createTabSet>, view: View,
 *   platform: import("./shell.js").Platform, settings(): import("./shell.js").Settings,
 *   id(): string, seen(next: number): void,
 *   resize(id: string, cols: number, rows: number, again?: boolean): void,
 *   show(id: string): void, buffer(session: Session): Promise<void>,
 *   launch(session: Session): Promise<void>,
 * }} deps
 */
export function createRestore(deps) {
  const { sessions, byProc, tabset, view, platform, settings } = deps;
  const shells = (/** @type {string | null} */ cwd) =>
    candidates(platform, settings()).map((p) => ({ ...p, cwd: cwd ?? settings().cwd }));

  /** The terminals a reload left: the same processes, in the tabs and splits they were in. */
  const reload = (/** @type {Snapshot} */ saved) => {
    deps.seen(saved.next);
    /** @type {Map<string, { cols: number, rows: number }>} */
    const sizes = new Map();
    const ids = new Set(saved.sessions.map((kept) => kept.id));
    // A snapshot from before split panes has no tabs: each session was a tab of its own.
    const tabs = (saved.tabs ?? []).filter((tab) => panesOf(tab.layout).every((id) => ids.has(id)));
    const placed = new Set(tabs.flatMap((tab) => panesOf(tab.layout)));
    for (const kept of saved.sessions) {
      if (!placed.has(kept.id)) tabs.push({ id: kept.id, layout: leaf(kept.id), focused: kept.id });
    }
    const keptOf = new Map(saved.sessions.map((kept) => [kept.id, kept]));
    for (const { id, layout, focused } of tabs) {
      const tab = tabset.restore(id, layout, focused);
      for (const pane of panesOf(tab.layout)) {
        const kept = /** @type {import("./types.js").Saved} */ (keptOf.get(pane));
        const programs = kept.program ? [kept.program] : shells(null);
        const session = restoredSession(kept, programs);
        sessions.set(session.id, session);
        sizes.set(session.id, view.open(session.id, session.title, tab.id));
        for (const chunk of kept.tail) view.write(session.id, decode(chunk));
      }
      view.layout(tab.id, tab.layout);
    }
    // Sized once every pane has its place in its tab.
    for (const session of [...tabset.panes()].map(
      (id) => /** @type {Session} */ (sessions.get(id)),
    )) {
      const size = sizes.get(session.id) ?? { cols: session.cols, rows: session.rows };
      if (session.procId) {
        byProc.set(session.procId, session.id);
        deps.resize(session.id, size.cols, size.rows, true);
      } else if (session.exit) {
        view.end(session.id, session.ended ?? session.exit);
      }
    }
    const first =
      saved.shown !== null && sessions.has(saved.shown)
        ? saved.shown
        : tabset.all().at(-1)?.focused;
    if (first !== undefined) deps.show(first);
  };

  /** The tabs a restart left in the store: each pane a new session with a fresh shell in its folder. */
  const restart = async (/** @type {Kept} */ kept) => {
    /** @type {Session[]} */
    const started = [];
    /** @type {string | undefined} */
    let first;
    for (const [at, { layout, focused }] of kept.tabs.entries()) {
      /** @type {string[]} */
      const ids = [];
      /** @returns {Layout} */
      const live = (/** @type {KeptNode} */ node) => {
        if ("pane" in node) {
          const session = blankSession(deps.id(), node.pane.title, shells(node.pane.cwd));
          session.named = node.pane.named;
          sessions.set(session.id, session);
          started.push(session);
          ids.push(session.id);
          return leaf(session.id);
        }
        return { split: node.split, ratio: node.ratio, a: live(node.a), b: live(node.b) };
      };
      const tree = live(layout);
      const tab = tabset.restore(/** @type {string} */ (ids[0]), tree, ids[focused] ?? "");
      for (const id of ids) {
        const session = /** @type {Session} */ (sessions.get(id));
        const size = view.open(id, session.title, tab.id);
        session.cols = size.cols;
        session.rows = size.rows;
      }
      view.layout(tab.id, tab.layout);
      if (at === (kept.shown ?? kept.tabs.length - 1)) first = tab.focused;
    }
    if (first !== undefined) deps.show(first);
    for (const session of started) {
      await deps.buffer(session);
      await deps.launch(session);
    }
  };

  return {
    reload,
    restart,
    /** Start: the reload snapshot, else the layout a restart left, else `open` one terminal. */
    async begin(
      /** @type {Snapshot | undefined} */ saved,
      /** @type {() => Promise<unknown>} */ open,
    ) {
      if (saved?.sessions?.length) {
        reload(saved);
        return;
      }
      const kept = readKept(
        await deps.bridge.call("store.get", { key: KEY }).then(
          (answer) => answer?.value,
          () => undefined,
        ),
      );
      if (kept) await restart(kept);
      else await open();
    },
  };
}
