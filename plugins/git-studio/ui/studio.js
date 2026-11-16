// The window put together: the controller (app.js), the views, and what their buttons, menus and
// keys do (actions.js). Operations that change the repository go through app.act, so each one is
// said on the status bar and the window reads the repository again after it.

import { createActions } from "./actions.js";
import { createApp, WIP } from "./app.js";
import { createCenter } from "./center.js";
import { fill } from "./dom.js";
import { createStatusbar, createToolbar, welcome } from "./view-chrome.js";
import { createDetail } from "./view-detail.js";
import { createDiffView } from "./view-diff.js";
import { createGraphView } from "./view-graph.js";
import { createSidebar } from "./view-sidebar.js";
import { createWip } from "./view-wip.js";

/**
 * @typedef {Pick<import("@endue-ai/plugin-sdk").PluginContext, "bridge" | "state"> &
 *   Partial<Pick<import("@endue-ai/plugin-sdk").PluginContext, "commands">>} Ctx
 * @param {Ctx} ctx
 * @param {Document} doc
 */
export function createStudio(ctx, doc) {
  const app = createApp(ctx);
  const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const shell = $("studio");
  const layer = $("layer");
  const detailPage = $("detail");
  const wipPage = $("wip");
  const actions = createActions(app, layer);

  const toolbar = createToolbar(app, $("toolbar"), {
    onTool: (action) => void tool(action),
    onOpen: (path) => void openRepo(path),
    onSearch: (query) => app.set({ query }),
  });
  createStatusbar(app, $("statusbar"));
  createSidebar(app, $("sidebar"), {
    onReveal: (sha) => {
      void app.select(sha);
      graph.reveal(sha);
    },
    onCheckout: (ref) => void actions.checkout(ref),
    onStash: (stash) => {
      void app.select(stash.parents[0] ?? null);
      if (stash.parents[0]) graph.reveal(stash.parents[0]);
    },
  });
  const graph = createGraphView(app, $("graph-host"), {});
  const center = createCenter(app, $("graph-host"), $("view-host"));
  const diff = createDiffView(app, center.page("diff"), {
    onBack: () => center.back(),
    onPatch: (patch, op, what) => actions.patch(patch, op, what),
    onFile: async (op, target) => {
      const file = { path: target.path, change: target.untracked ? "?" : "M" };
      if (op === "stage") await actions.stage([target.path]);
      else if (op === "unstage") await actions.unstage([target.path]);
      else await actions.discard([file]);
      const s = app.get().snapshot?.status;
      const still = op === "stage" ? s?.staged : s?.unstaged;
      if (still?.some((f) => f.path === target.path))
        void diff.show({
          ...target,
          kind: op === "stage" ? "staged" : "unstaged",
          untracked: false,
        });
      else center.back();
    },
  });
  /** Open the diff of a working copy file; prev and next walk every changed file. */
  function openWipDiff(/** @type {import("./view-wip.js").WipFile} */ item) {
    const s = app.get().snapshot?.status;
    if (!s) return;
    /** @param {import("./parse-status.js").FileChange} f @param {boolean} staged */
    const targetOf = (f, staged) => ({
      kind: /** @type {"staged" | "unstaged"} */ (staged ? "staged" : "unstaged"),
      path: f.path,
      ...(staged && f.origPath ? { origPath: f.origPath } : {}),
      untracked: f.change === "?",
    });
    const list = [
      ...s.unstaged.map((f) => targetOf(f, false)),
      ...s.staged.map((f) => targetOf(f, true)),
    ];
    center.show("diff");
    void diff.show(targetOf(item.file, item.staged), list);
  }
  const detail = createDetail(app, detailPage, {
    onCopy: (text) => {
      void navigator.clipboard?.writeText(text).catch(() => {});
      app.say("Copied");
    },
    onFile: (file, commit) => {
      /** @param {import("./parse.js").ChangedFile} f */
      const targetOf = (f) => ({
        kind: /** @type {"commit"} */ ("commit"),
        path: f.path,
        ...(f.origPath ? { origPath: f.origPath } : {}),
        sha: commit.sha,
        parent: commit.parents[0] ?? null,
      });
      center.show("diff");
      void diff.show(targetOf(file), commit.files.map(targetOf));
    },
    onAction: (action) => app.say(`${action}: coming soon`),
  });
  createWip(app, wipPage, {
    onStage: (paths) => void actions.stage(paths),
    onUnstage: (paths) => void actions.unstage(paths),
    onDiscard: (files) => void actions.discard(files),
    onFile: (item) => openWipDiff(item),
    onResolve: () => app.say("The conflict tool comes next"),
    onCommit: (draft) => actions.commit(draft),
    onAmend: (on) => actions.amendMessage(on),
    onAi: async () => {
      app.say("AI comes next");
      return null;
    },
    onStash: () => void actions.stash(),
    onMenu: () => {},
  });

  /** @param {import("./view-chrome.js").ToolAction} action */
  async function tool(action) {
    switch (action) {
      case "refresh":
        return app.refresh();
      case "sidebar":
        app.set({ sidebar: !app.get().sidebar });
        return app.keep();
      case "repo":
        return app.set({ repo: null, snapshot: null });
      case "search":
        return toolbar.focusSearch();
      case "fetch":
        return actions.fetch();
      case "pull":
        return actions.pull();
      case "push":
        return actions.push();
      case "stash":
        return actions.stash();
      case "pop":
        return actions.pop();
      default:
        app.say(`${action}: coming soon`);
    }
  }

  async function openRepo(/** @type {string} */ path) {
    await app.open(path).catch(() => {});
  }

  function layout() {
    const { repo, sidebar: side } = app.get();
    shell.classList.toggle("no-repo", !repo);
    shell.classList.toggle("no-sidebar", !side);
    if (!repo)
      fill(
        $("welcome"),
        welcome(app, (path) => void openRepo(path)),
      );
  }
  function panel() {
    const wip = app.get().selected === WIP;
    wipPage.hidden = !wip;
    detailPage.hidden = wip;
  }
  app.subscribe((state, previous) => {
    if (
      state.repo !== previous.repo ||
      state.sidebar !== previous.sidebar ||
      state.error !== previous.error
    )
      layout();
    if (state.selected !== previous.selected) {
      panel();
      if (state.selected !== WIP) detail.draw();
    }
  });
  layout();
  panel();

  doc.addEventListener("keydown", (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    const typing = target.closest("input, textarea, select, [contenteditable]");
    if (event.key === "/" && !typing) {
      event.preventDefault();
      toolbar.focusSearch();
    } else if (event.key === "Escape" && !typing && app.get().center !== "graph") {
      center.back();
      graph.focus();
    } else if (event.key === "Escape" && typing && target.classList.contains("tool-search")) {
      toolbar.setSearch("");
      app.set({ query: "" });
      graph.focus();
    }
  });

  ctx.commands?.on(
    "endue.git-studio.open",
    async (/** @type {{ path?: string } | undefined} */ args) => {
      const path = args?.path ?? app.restore();
      if (!path) return { opened: null };
      return { opened: await app.open(path) };
    },
  );

  const last = app.restore();
  if (last) void openRepo(last);
  return { app, graph, actions };
}
