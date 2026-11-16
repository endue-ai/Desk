// Docker Studio put together: the store, docker over the bridge, the engine and its live streams,
// the frame, and the page on screen. Pages are made when they show and dropped when they leave;
// each hears the store's changes and draws only what changed.

import { createEngine } from "./engine.js";
import { installFeatures } from "./features.js";
import { createLive } from "./live.js";
import { stacksOf } from "./model.js";
import { createOverlay } from "./overlay.js";
import { createRunner } from "./run.js";
import { createStore } from "./store.js";
import { createShell } from "./view-shell.js";

/**
 * @typedef {{ element: HTMLElement, title: string, subtitle?: string, stats?: boolean,
 *   tools?(): HTMLElement[], update(state: any, changed: Set<string>): void, dispose?(): void,
 *   search?(text: string): void, key?(event: KeyboardEvent): boolean }} Page
 * @typedef {{ kind: string, id: string, tab?: string }} Target
 * @typedef {ReturnType<typeof createStudio>} App
 */

/**
 * @param {any} ctx The plugin context (bridge, state, commands, settings).
 * @param {Document} doc
 * @param {Record<string, (app: App, target?: Target) => Page>} pages
 */
export function createStudio(ctx, doc, pages) {
  const store = createStore();
  const runner = createRunner(ctx.bridge, {
    onBusy: (running) => store.set({ busy: running }),
    context: () => store.state.context,
    path: () => settings.path,
  });
  const settings = { path: "", stopTimeout: 10, logTail: 500, shell: "/bin/sh", confirm: true };
  /** docker that also says when the engine went away. */
  const docker = (/** @type {string[]} */ args, /** @type {any} */ options) =>
    runner.run(args, options);
  const engine = createEngine({ docker, store });
  const live = createLive({
    runner,
    store,
    engine,
    visible: () => doc.visibilityState !== "hidden",
  });

  /** @type {Page | null} */
  let page = null;
  /** @type {Target | null} */
  let target = null;
  const saved = ctx.state?.get?.() ?? {};
  /** Each section's own choices (filter, grouping, sort), kept across reloads. */
  /** @type {Record<string, any>} */
  const prefs = { ...(saved.prefs ?? {}) };
  const persist = () =>
    ctx.state?.set?.({ page: store.state.page, detail: store.state.detail, prefs });
  /** The stacks, made once per change of the containers or the projects. */
  /** @type {{ containers: unknown, projects: unknown, value: ReturnType<typeof stacksOf> } | null} */
  let stackMemo = null;

  const overlay = createOverlay(doc);

  const shell = createShell(doc, {
    go: (id) => app.go(id),
    assistant: () => app.ai.open(),
    cleanup: () => app.dialogs.cleanup(),
    settings: () => app.go("settings"),
    refresh: () => void live.refresh(),
    search: (text) => page?.search?.(text),
  });

  const show = (/** @type {string} */ id, /** @type {Target | null} */ to) => {
    page?.dispose?.();
    page?.element.remove();
    target = to;
    const make = pages[to ? to.kind : id] ?? pages.missing;
    if (!make) return;
    page = make(app, to ?? undefined);
    shell.content.replaceChildren(page.element);
    shell.heading(page.title, page.subtitle ?? "");
    shell.pageTools(...(page.tools?.() ?? []));
    shell.current(id);
    shell.search.value = "";
    store.set({ page: id, detail: to });
    page.update(store.state, new Set(Object.keys(store.state)));
    persist();
  };

  store.on(null, (state, changed) => {
    if (changed.has("engine")) shell.engine(state);
    if (
      ["containers", "images", "volumes", "networks", "projects", "disk"].some((k) =>
        changed.has(k),
      )
    )
      shell.counts(state);
    shell.status(state, live.total);
    page?.update(state, changed);
    if (page && (changed.has("containers") || changed.has("images"))) {
      shell.heading(page.title, page.subtitle ?? "");
    }
  });
  live.onStats(() => shell.status(store.state, live.total));

  doc.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(
      /** @type {HTMLElement} */ (event.target)?.tagName ?? "",
    );
    if (overlay.open()) return;
    if (page?.key?.(event)) return;
    if (typing) return;
    if (event.key === "/") {
      event.preventDefault();
      shell.search.focus();
    } else if (event.key === "a" || event.key === "A") {
      event.preventDefault();
      app.ai.open();
    } else if (event.key === "Escape" && target) {
      event.preventDefault();
      app.back();
    }
  });

  const app = {
    ctx,
    store,
    runner,
    docker,
    engine,
    live,
    overlay,
    settings,
    /** Stacks being changed now (a spinner on their row). @type {Set<string>} */
    pending: new Set(),
    /** The Compose stacks, from compose ls and the containers' labels. */
    stacks() {
      const { containers, projects } = store.state;
      if (stackMemo?.containers !== containers || stackMemo?.projects !== projects)
        stackMemo = { containers, projects, value: stacksOf(containers, projects) };
      return stackMemo.value;
    },
    /** A section's saved choices, with defaults. @template T @param {string} name @param {T} defaults @returns {T} */
    prefs(name, defaults) {
      prefs[name] = { ...defaults, ...(prefs[name] ?? {}) };
      return prefs[name];
    },
    /** @param {string} name @param {unknown} value */
    savePrefs(name, value) {
      prefs[name] = value;
      persist();
    },
    /** Show a section. @param {string} id */
    go(id) {
      show(id, null);
    },
    /** Show one object's page (a container, an image, a stack…). @param {Target} to */
    open(to) {
      const section =
        to.kind === "container" ? "containers" : to.kind === "project" ? "compose" : `${to.kind}s`;
      show(section, to);
    },
    /** Back from an object's page to its section. */
    back() {
      show(store.state.page, null);
    },
    /** The page's buttons changed (a selection, a state). */
    retool() {
      shell.pageTools(...(page?.tools?.() ?? []));
      if (page) shell.heading(page.title, page.subtitle ?? "");
    },
    /** @param {string} text @param {"info" | "success" | "danger"} [kind] */
    toast(text, kind = "info") {
      overlay.toast(text, kind);
    },
    // Filled in by the features (actions.js, dialogs, ai.js).
    act: /** @type {any} */ ({}),
    images: /** @type {any} */ ({}),
    objects: /** @type {any} */ ({}),
    builds: /** @type {any} */ ({}),
    menus: /** @type {any} */ ({}),
    dialogs: /** @type {any} */ ({}),
    ai: /** @type {any} */ ({
      open() {},
      diagnose() {},
      explainLogs() {},
      optimizeImage() {},
      explainBuild() {},
      tailorScaffold() {},
    }),
    start() {
      installFeatures(app);
      show(saved.page ?? "dashboard", saved.detail ?? null);
      shell.engine(store.state);
      void live.start();
      // One docker stats stream feeds the status bar and every chart; it rests while the page is hidden.
      live.wantStats(doc.visibilityState !== "hidden");
      doc.addEventListener("visibilitychange", () =>
        live.wantStats(doc.visibilityState !== "hidden"),
      );
    },
  };
  return app;
}
