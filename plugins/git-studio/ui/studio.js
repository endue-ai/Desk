// The window put together: the controller (app.js), the views, and what their buttons, menus and
// keys do. Operations that change the repository go through app.act, so each one is said on the
// status bar and the window reads the repository again after it.

import { createApp, WIP } from "./app.js";
import { fill } from "./dom.js";
import { createOps } from "./ops.js";
import { createStatusbar, createToolbar, welcome } from "./view-chrome.js";
import { createDetail } from "./view-detail.js";
import { createGraphView } from "./view-graph.js";
import { createSidebar } from "./view-sidebar.js";

/**
 * @param {Pick<import("@endue-ai/plugin-sdk").PluginContext, "bridge" | "state"> & Partial<Pick<import("@endue-ai/plugin-sdk").PluginContext, "commands">>} ctx
 * @param {Document} doc
 */
export function createStudio(ctx, doc) {
  const app = createApp(ctx);
  const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const shell = $("studio");
  const center = $("center");
  const graphHost = $("graph-host");
  const panel = $("panel");
  const ops = () => createOps(app.git, /** @type {string} */ (app.get().repo));

  const toolbar = createToolbar(app, $("toolbar"), {
    onTool: (action) => void tool(action),
    onOpen: (path) => void openRepo(path),
    onSearch: (query) => app.set({ query }),
  });
  createStatusbar(app, $("statusbar"));
  const sidebar = createSidebar(app, $("sidebar"), {
    onReveal: (sha) => {
      void app.select(sha);
      graph.reveal(sha);
    },
    onCheckout: (ref) =>
      void app.act(`Switched to ${ref.name}`, () =>
        ops().checkout({
          ref: ref.name,
          remote: ref.kind === "remote",
          detach: ref.kind === "tag",
        }),
      ),
  });
  const graph = createGraphView(app, graphHost, {});
  const detail = createDetail(app, panel, {
    onCopy: (text) => {
      void navigator.clipboard?.writeText(text).catch(() => {});
      app.say("Copied");
    },
  });

  /** @param {import("./view-chrome.js").ToolAction} action */
  async function tool(action) {
    if (action === "refresh") return app.refresh();
    if (action === "sidebar") {
      app.set({ sidebar: !app.get().sidebar });
      app.keep();
      return;
    }
    if (action === "repo") {
      app.set({ repo: null, snapshot: null });
      return;
    }
    if (action === "search") return toolbar.focusSearch();
    if (action === "fetch") return app.act("Fetched every remote", () => ops().fetch());
    if (action === "pull") return app.act("Pulled", () => ops().pull());
    if (action === "push") return app.act("Pushed", () => ops().push());
    app.say(`${action}: not available yet`);
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
  app.subscribe((state, previous) => {
    if (
      state.repo !== previous.repo ||
      state.sidebar !== previous.sidebar ||
      state.error !== previous.error
    )
      layout();
    if (state.selected !== previous.selected && state.selected !== WIP) detail.draw();
  });
  layout();

  doc.addEventListener("keydown", (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    const typing = target.closest("input, textarea, [contenteditable]");
    if (event.key === "/" && !typing) {
      event.preventDefault();
      toolbar.focusSearch();
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

  void center;
  void sidebar;
  const last = app.restore();
  if (last) void openRepo(last);
  return { app, graph };
}
