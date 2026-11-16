// The window put together: the controller (app.js), the views, and what their buttons, menus and
// keys do (actions*.js, menus.js). Operations that change the repository go through app.act, so
// each one is said on the status bar and the window reads the repository again after it.

import { createActions } from "./actions.js";
import { createHistoryActions } from "./actions-history.js";
import { createApp, WIP } from "./app.js";
import { createBanner } from "./banner.js";
import { createCenter } from "./center.js";
import { fill } from "./dom.js";
import { createMenus } from "./menus.js";
import { menu } from "./overlay.js";
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
  const history = createHistoryActions(app, layer);
  const snap = () => app.get().snapshot;
  const copy = (/** @type {string} */ text) => {
    void navigator.clipboard?.writeText(text).catch(() => {});
    app.say("Copied");
  };
  /** Late-bound features (the conflict tool, history and blame, AI) fill these in. */
  const extra = {
    explain: (/** @type {string} */ _sha) => app.say("AI is not available here."),
    history: (/** @type {string} */ _path) => {},
    blame: (/** @type {string} */ _path) => {},
    resolve: (/** @type {string} */ _path) => {},
    writeMessage: async () => /** @type {string | null} */ (null),
  };
  const menus = createMenus(app, layer, actions, history, {
    copy,
    explain: (sha) => extra.explain(sha),
    openRepo: (path) => void openRepo(path),
    history: (path) => extra.history(path),
  });

  const toolbar = createToolbar(app, $("toolbar"), {
    onTool: (action, event) => void tool(action, event),
    onOpen: (path) => void openRepo(path),
    onSearch: (query) => app.set({ query }),
  });
  createStatusbar(app, $("statusbar"));
  createBanner(app, $("banner"), {
    onProceed: (how) => void history.proceed(how),
    onResolve: (path) => extra.resolve(path),
  });
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
    onMenu: (event, entry) => menus.sideMenu(event, entry),
    onDropRef: (dragged, target, event) => menus.dropMenu(event, dragged, target.name),
  });
  const graph = createGraphView(app, $("graph-host"), {
    onMenu: (event, item) => menus.commitMenu(event, item),
    onOpen: (item) => {
      if (item.sha === WIP) return;
      const branch = snap()?.refs.find(
        (r) => r.kind === "head" && r.sha === item.sha && !r.current,
      );
      if (branch) void actions.checkout(branch);
    },
    onDropRef: (dragged, item, event) => {
      const here = snap()?.refs.find((r) => r.kind === "head" && r.sha === item.sha);
      menus.dropMenu(event, dragged, here?.name ?? item.sha);
    },
  });
  const center = createCenter(app, $("graph-host"), $("view-host"));
  const diff = createDiffView(app, center.page("diff"), {
    onBack: () => center.back(),
    onPatch: (patch, op, what) => actions.patch(patch, op, what),
    onFile: async (op, target) => {
      const file = { path: target.path, change: target.untracked ? "?" : "M" };
      if (op === "stage") await actions.stage([target.path]);
      else if (op === "unstage") await actions.unstage([target.path]);
      else await actions.discard([file]);
      const s = snap()?.status;
      const still = op === "stage" ? s?.staged : s?.unstaged;
      if (still?.some((f) => f.path === target.path))
        void diff.show({
          ...target,
          kind: op === "stage" ? "staged" : "unstaged",
          untracked: false,
        });
      else center.back();
    },
    onHistory: (path) => extra.history(path),
    onBlame: (path) => extra.blame(path),
  });

  /** Open the diff of a working copy file; prev and next walk every changed file. */
  function openWipDiff(/** @type {import("./view-wip.js").WipFile} */ item) {
    const s = snap()?.status;
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
    onCopy: copy,
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
    onAction: (action, commit) => {
      if (action === "explain") extra.explain(commit.sha);
      else if (action === "cherry-pick") void history.cherryPick(commit);
      else if (action === "revert") void history.revert(commit);
      else {
        const row = doc.querySelector(`.graph-row[data-sha="${commit.sha}"]`);
        const box = (row ?? detailPage).getBoundingClientRect();
        const item = graph.items().find((i) => i.sha === commit.sha);
        if (item)
          menus.commitMenu(
            /** @type {MouseEvent} */ ({ clientX: box.left + 200, clientY: box.top + 20 }),
            item,
          );
      }
    },
  });
  createWip(app, wipPage, {
    onStage: (paths) => void actions.stage(paths),
    onUnstage: (paths) => void actions.unstage(paths),
    onDiscard: (files) => void actions.discard(files),
    onFile: (item) => openWipDiff(item),
    onResolve: (path) => extra.resolve(path),
    onCommit: (draft) => actions.commit(draft),
    onAmend: (on) => actions.amendMessage(on),
    onAi: () => extra.writeMessage(),
    onStash: () => void actions.stash(),
    onMenu: (event) => menus.wipMenu(event),
  });

  /** @param {import("./view-chrome.js").ToolAction} action @param {MouseEvent} [event] */
  async function tool(action, event) {
    switch (action) {
      case "refresh":
        return app.refresh();
      case "sidebar":
        app.set({ sidebar: !app.get().sidebar });
        return app.keep();
      case "repo":
        return app.set({ repo: null, snapshot: null });
      case "branch":
        return branchPicker(event);
      case "search":
        return toolbar.focusSearch();
      case "undo":
        return history.undo();
      case "redo":
        return history.redo();
      case "fetch":
        return actions.fetch();
      case "pull":
        return actions.pull();
      case "push":
        return actions.push();
      case "new-branch": {
        const selected = app.get().selected;
        return history.createBranch(selected && selected !== WIP ? selected : null);
      }
      case "stash":
        return actions.stash();
      case "pop":
        return actions.pop();
      case "ai":
        return aiMenu(event);
      default:
        app.say(`${action}: not available`);
    }
  }

  /** The toolbar's branch button: switch to a local branch, or make a new one. */
  function branchPicker(/** @type {MouseEvent | undefined} */ event) {
    const s = snap();
    if (!s) return;
    const box = /** @type {HTMLElement} */ (
      event?.currentTarget ?? $("toolbar")
    ).getBoundingClientRect();
    const heads = s.refs.filter((r) => r.kind === "head").sort((a, b) => b.date - a.date);
    menu(layer, { x: box.left, y: box.bottom + 4 }, [
      ...heads.slice(0, 14).map((ref) => ({
        label: ref.name,
        icon: /** @type {const} */ (ref.current ? "check" : "branch"),
        hint: ref.ahead || ref.behind ? `↑${ref.ahead} ↓${ref.behind}` : undefined,
        disabled: ref.current,
        run: () => void actions.checkout(ref),
      })),
      "-",
      { label: "New branch…", icon: "plus", run: () => void history.createBranch(null) },
    ]);
  }

  /** The toolbar's AI button: what it can write or explain now. */
  function aiMenu(/** @type {MouseEvent | undefined} */ event) {
    const box = /** @type {HTMLElement} */ (
      event?.currentTarget ?? $("toolbar")
    ).getBoundingClientRect();
    const selected = app.get().selected;
    menu(layer, { x: box.right - 260, y: box.bottom + 4 }, [
      {
        label: "Write the commit message",
        icon: "sparkle",
        disabled: !snap()?.status.staged.length,
        run: () => {
          void app.select(WIP);
          void extra.writeMessage();
        },
      },
      {
        label: "Explain the selected commit",
        icon: "sparkle",
        disabled: !selected || selected === WIP,
        run: () => extra.explain(selected ?? ""),
      },
    ]);
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
    const mod = event.metaKey || event.ctrlKey;
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
    } else if (mod && event.key.toLowerCase() === "z" && !typing && app.get().repo) {
      event.preventDefault();
      void (event.shiftKey ? history.redo() : history.undo());
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
  return { app, graph, actions, history, center, diff, extra, layer };
}
