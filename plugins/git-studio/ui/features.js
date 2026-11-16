// The features that hang off the studio's hooks (studio.extra): the merge conflict tool, a file's
// history and blame, and the AI. Kept apart so studio.js stays the window's frame.

import { WIP } from "./app.js";
import { registerCommands } from "./commands.js";
import { installAi } from "./features-ai.js";
import { shortSha } from "./format.js";
import { deepSearch } from "./history.js";
import { createBlameView } from "./view-blame.js";
import { createConflictView } from "./view-conflict.js";
import { createHistoryView } from "./view-history.js";

/**
 * @param {ReturnType<typeof import("./studio.js").createStudio>} studio
 * @param {Pick<import("@endue-ai/plugin-sdk").PluginContext, "bridge"> & Partial<Pick<import("@endue-ai/plugin-sdk").PluginContext, "commands">>} [ctx]
 */
export function installFeatures(studio, ctx) {
  const { app, center, extra } = studio;
  const snap = () => app.get().snapshot;

  /** What to call each side: in a rebase "ours" is the branch being rebased onto. */
  function labels() {
    const s = snap();
    const branch = s?.status.branch ?? "HEAD";
    const head = s?.operationHead ?? null;
    const named = head ? s?.refs.find((r) => r.sha === head && r.kind !== "tag")?.name : undefined;
    const incoming = named ?? (head ? shortSha(head) : "incoming");
    if (s?.operation === "rebase")
      return {
        ours: `${branch === "HEAD" ? "the branch rebased onto" : branch}`,
        theirs: `your commit ${incoming}`,
      };
    return { ours: branch, theirs: incoming };
  }

  const conflict = createConflictView(app, center.page("conflict"), {
    onBack: () => center.back(),
    labels,
    onAi: (file, chunk) => extra.resolveWithAi?.(file, chunk) ?? Promise.resolve(null),
    onSaved: async (path) => {
      await app.refresh();
      const next = snap()?.status.conflicts.find((c) => c.path !== path);
      if (next) return conflict.open(next.path);
      center.back();
      void app.select(WIP);
    },
  });
  extra.resolve = (path) => {
    center.show("conflict");
    void conflict.open(path);
  };

  /** Show a commit in the graph; one older than the loaded page is said, not lost silently. */
  const reveal = (/** @type {string} */ sha) => {
    center.back();
    void app.select(sha);
    if (!studio.graph.reveal(sha))
      app.say("That commit is older than the commits loaded: load more to see it.");
  };
  const fileLog = createHistoryView(app, center.page("history"), {
    onBack: () => center.back(),
    onReveal: reveal,
    onBlame: (path, rev) => extra.blame(path, rev),
  });
  const blameView = createBlameView(app, center.page("blame"), {
    onBack: () => center.back(),
    onReveal: reveal,
    onHistory: (path) => extra.history(path),
  });
  extra.history = (path) => {
    center.show("history");
    void fileLog.open(path);
  };
  extra.blame = (path, rev = null) => {
    center.show("blame");
    void blameView.open(path, rev);
  };

  // Deep search: code changes (the pickaxe) or file paths, asked of git a moment after typing stops.
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  let seq = 0;
  /** @param {import("./app.js").State} state */
  function searchDeep(state) {
    if (timer !== undefined) clearTimeout(timer);
    const query = state.query.trim();
    const mode = /** @type {"text" | "code" | "path"} */ (state.searchMode);
    if (mode === "text" || query.length < 2 || !state.repo) return;
    const root = state.repo;
    timer = setTimeout(async () => {
      const mine = ++seq;
      try {
        const found = await deepSearch(app.git, root, mode, query);
        if (mine === seq) app.set({ deep: found });
      } catch (error) {
        app.say(error instanceof Error ? error.message : String(error), "danger");
      }
    }, 350);
  }
  app.subscribe((state, previous) => {
    if (
      state.query !== previous.query ||
      state.searchMode !== previous.searchMode ||
      state.repo !== previous.repo
    )
      searchDeep(state);
    if (
      state.query !== previous.query ||
      state.deep !== previous.deep ||
      state.snapshot !== previous.snapshot ||
      state.searchMode !== previous.searchMode
    ) {
      const count = state.query.trim() ? studio.graph.matchCount() : null;
      studio.toolbar.setCount(count === null ? "" : count === 0 ? "none" : `${count} found`);
    }
  });

  const ai = ctx ? installAi(studio, ctx.bridge, { labels }) : null;
  if (ctx?.commands) registerCommands(studio, ctx.commands);
  return { conflict, fileLog, blameView, ai };
}
