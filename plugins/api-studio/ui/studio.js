// The window put together: the rail and side panel, the tab strip, and the request in front with
// its URL bar over the request and response panes, split side by side or one above the other
// (dragged to any ratio). Features plug in through `S`: scopes, parents, hooks, sections, panels.

import { createActions } from "./actions.js";
import { createApp } from "./app.js";
import { h, icon, keys } from "./dom.js";
import { createEngine } from "./engine.js";
import { installCollections } from "./features-collections.js";
import { groupPane } from "./group-pane.js";
import { closeMenus } from "./menu.js";
import { pair } from "./model.js";
import { createRuntime } from "./runtime.js";
import { withoutSecrets } from "./secret-names.js";
import { drawBody } from "./section-body.js";
import { scope } from "./vars.js";
import { requestPane } from "./view-request.js";
import { responsePane } from "./view-response.js";
import { sideBar } from "./view-side.js";
import { tabStrip } from "./view-tabs.js";
import { urlBar } from "./view-urlbar.js";
import "./section-basic.js";
import "./section-auth.js";
import "./section-settings.js";
import "./section-vars.js";
import "./section-docs.js";
import { createAsker } from "./ai-ask.js";
import { installAssistant } from "./assistant.js";
import { installAuth } from "./features-auth.js";
import { installEnvironments } from "./features-env.js";
import { installImport } from "./features-import.js";
import { installRunner } from "./features-runner.js";
import { installScripts } from "./features-scripts.js";
import { installGuards } from "./guards.js";
import { withoutLiterals } from "./literals.js";

/**
 * @typedef {import("./app.js").Tab} Tab
 * @typedef {import("./vars.js").Scope} Scope
 * @typedef {Record<string, any> & { app: import("./app.js").App, ctx: any }} Studio
 */

/** @param {any} ctx @param {Document} doc */
export function createStudio(ctx, doc) {
  const app = createApp({
    load: () => ctx.state?.get?.(),
    save: (value) => ctx.state?.set?.(value),
  });
  /** @type {Map<string, string>} */
  const resViews = new Map();
  /** @type {Map<string, string>} */
  const resFilters = new Map();

  const runtime = createRuntime();
  const S = {
    ctx,
    app,
    engine: createEngine(ctx.bridge, { program: () => S.settings.curl }),
    settings: { curl: "", history: true },
    /** Scope providers other features add (environments, collections, globals), narrowest last. @type {((tab: Tab) => Scope[])[]} */
    scopeProviders: [],
    /** Values set while running (scripts, captures), per collection (runtime.js). */
    runtime: runtime.loose,
    runtimeOf: runtime.of,
    setRuntime: runtime.set,
    clearRuntime: runtime.clear,
    /** @param {Tab} tab @returns {Scope[]} */
    scopes(tab) {
      const all = [
        runtime.of(tab),
        ...(tab.data ? [scope("data", "Data row", tab.data)] : []),
        scope("request", "Request", tab.req.vars.pre),
        ...S.scopeProviders.flatMap((p) => p(tab)),
      ];
      // A request an agent writes gets no runtime values (captures, script results): any of them
      // may be a token under a plain name.
      return tab.agent ? withoutSecrets(all.filter((s) => s.name !== "runtime")) : all;
    },
    /** The auth of a request's folders and collection, nearest first. @param {Tab} _tab @returns {import("./model.js").Auth[]} */
    parentAuth: (_tab) => [],
    /** The names of those parents, for "inherits from". @param {Tab} _tab @returns {string[]} */
    parentNames: (_tab) => [],
    /** Headers every request under a folder or collection gets. @param {Tab} _tab @returns {import("./model.js").Pair[]} */
    parentHeaders: (_tab) => [],
    /** Headers the desk adds without being asked, for the Headers section. @param {Tab} tab @returns {[string, string][]} */
    autoHeaders: (tab) => [
      ["User-Agent", "curl (the desk's API Studio)"],
      ["Accept", "*/*"],
      ...(tab.req.settings.decompress
        ? /** @type {[string, string][]} */ ([["Accept-Encoding", "deflate, gzip, br"]])
        : []),
      ...(tab.req.body.mode !== "none"
        ? /** @type {[string, string][]} */ ([["Content-Length", "the body's size"]])
        : []),
    ],
    drawBody: (/** @type {Tab} */ tab) => drawBody(S, tab),
    /** What draws a tab of another kind than a request. @type {Record<string, (S: any, tab: Tab) => { el: HTMLElement, pane?: any }>} */
    panes: { group: groupPane },
    /** Environment scopes for a tab (the environments feature replaces this). @param {Tab} _tab @returns {Scope[]} */
    envScopes: (_tab) => [],
    /** The global variables' scope (the environments feature replaces this). @returns {Scope[]} */
    globalScopes: () => [],
    /** Save a tab to its collection; collections replace this. @param {Tab} _tab @returns {Promise<boolean>} */
    save: async (_tab) => {
      app.toast("Open or make a collection to save requests in.", "info");
      return false;
    },
    /** @param {Tab} _tab */
    fetchToken: async (_tab) => app.toast("OAuth 2.0 is not set up in this build.", "error"),
    /** Ask for a file and give back its path. @returns {Promise<string | undefined>} */
    pickFile: async () => {
      try {
        const chosen = await ctx.bridge.call("dialog.open", { title: "Choose a file" });
        return chosen?.cancelled ? undefined : chosen?.paths?.[0];
      } catch {
        return undefined;
      }
    },
    /** @param {Tab} _tab @param {string} _text */
    importCurl: (_tab, _text) => false,
    /** @param {Tab} tab */
    resView: (tab) => resViews.get(tab.id) ?? "pretty",
    /** @param {Tab} tab */
    resFilter: (tab) => resFilters.get(tab.id) ?? "",
    /** @param {Tab} tab @param {string} filter */
    setResFilter: (tab, filter) => resFilters.set(tab.id, filter),
    /** Capture the value at a path of the response as a variable of the request. @param {Tab} tab @param {string} path */
    captureFrom(tab, path) {
      const last = /([A-Za-z_][\w]*)\W*$/.exec(path.replace(/\[\d+\]$/, ""))?.[1] ?? "value";
      let name = last === "body" ? "value" : last;
      const taken = new Set(tab.req.vars.post.map((p) => p.key));
      for (let i = 2; taken.has(name); i++) name = `${last}${i}`;
      tab.req.vars.post = [...tab.req.vars.post, pair({ key: name, value: path })];
      app.emit("req", { field: "vars" });
      app.toast(`Each response now sets {{${name}}} from ${path}`, "ok");
    },
    /** @param {Tab} tab @param {string} view */
    setResView(tab, view) {
      resViews.set(tab.id, view);
      app.emit("response", tab);
    },
    openSettings: () => {},
    focusUrl: () => {},
    /** @type {((tab: Tab) => void) | undefined} */
    explain: undefined,
    /** @type {((tab: Tab) => void) | undefined} */
    showCode: undefined,
    /** @type {((entry: import("./app.js").HistoryEntry) => void) | undefined} */
    saveHistory: undefined,
    .../** @type {ReturnType<typeof createActions>} */ ({}),
  };
  Object.assign(S, createActions(S));

  /** The cards the home page offers; features add theirs. @type {() => { icon: import("./dom.js").IconName, label: string, text: string, keys?: string, run(): void }[]} */
  S.homeActions = () => [
    {
      icon: "plus",
      label: "New request",
      text: "Start from an empty request",
      keys: "Mod+T",
      run: () => app.blank(),
    },
  ];

  installCollections(S);
  installEnvironments(S);
  const auth = installAuth(S);
  installScripts(S);
  installRunner(S);
  installImport(S);
  installGuards(S);
  S.asker = createAsker(ctx.bridge);
  installAssistant(S);

  // ── the window ──────────────────────────────────────────────────────────
  const side = sideBar(S);
  const tabs = tabStrip(S);
  tabs.setRight(S.envPicker());
  const work = h("div.as-work");
  const toast = h("div.as-toast", { role: "status", "aria-live": "polite" });
  const main = h("main.as-main", null, tabs.el, work);
  const root = h("div.as-app", null, side.rail, side.panel, side.grip, main, toast);
  doc.body.append(root);

  /** @type {{ url?: ReturnType<typeof urlBar>, req?: ReturnType<typeof requestPane>, res?: ReturnType<typeof responsePane>, tab: Tab } | undefined} */
  let view;

  const home = () =>
    h(
      "div.as-home",
      null,
      h("div.as-home-mark", null, icon("mark", 34)),
      h("h1", null, "API Studio"),
      h(
        "p.as-home-sub",
        null,
        "Build, send and test HTTP requests. Collections are folders of plain files you can keep in Git.",
      ),
      h(
        "div.as-home-actions",
        null,
        ...S.homeActions().map((a) =>
          h(
            "button.desk-btn.as-home-card",
            { type: "button", onClick: a.run },
            h("span.as-home-icon", null, icon(a.icon, 20)),
            h("span.as-home-text", null, h("strong", null, a.label), h("span", null, a.text)),
            a.keys ? h("kbd", null, keys(a.keys)) : null,
          ),
        ),
      ),
    );

  const split = () => {
    const { split: dir, ratio } = app.state.layout;
    const pane = h(`div.as-split.is-${dir}`);
    pane.style.setProperty("--as-ratio", String(ratio));
    return pane;
  };

  const drawWork = () => {
    const tab = app.current();
    if (!tab) {
      view = undefined;
      work.replaceChildren(home());
      return;
    }
    const custom = tab.kind ? S.panes[tab.kind] : undefined;
    if (custom) {
      const pane = custom(S, tab);
      work.replaceChildren(pane.el);
      view = { req: pane.pane, tab };
      return;
    }
    const url = urlBar(S, tab);
    const req = requestPane(S, tab);
    const res = responsePane(S, tab);
    const gutter = h("div.as-gutter-split", { role: "separator", "aria-label": "Resize" });
    const box = split();
    box.append(req.el, gutter, res.el);
    gutter.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      const rect = box.getBoundingClientRect();
      const vertical = app.state.layout.split === "v";
      const move = (/** @type {PointerEvent} */ e) => {
        const r = vertical
          ? (e.clientY - rect.top) / rect.height
          : (e.clientX - rect.left) / rect.width;
        const ratio = Math.max(0.2, Math.min(0.8, r));
        box.style.setProperty("--as-ratio", String(ratio));
        app.state.layout.ratio = ratio;
      };
      const up = () => {
        removeEventListener("pointermove", move);
        removeEventListener("pointerup", up);
        app.layout({});
      };
      addEventListener("pointermove", move);
      addEventListener("pointerup", up);
    });
    const flip = h(
      "button.desk-icon-btn.as-flip",
      {
        type: "button",
        "aria-label": "Put the response beside or below the request",
        title: "Put the response beside or below the request",
        onClick: () => {
          app.layout({ split: app.state.layout.split === "h" ? "v" : "h" });
          drawWork();
        },
      },
      icon(app.state.layout.split === "h" ? "splitRows" : "split", 16),
    );
    url.el.append(flip);
    work.replaceChildren(url.el, box);
    view = { url, req, res, tab };
    S.focusUrl = () => url.focus();
  };

  app.on("tab", drawWork);
  app.on("tabs", () => {
    if (!app.current()) drawWork();
  });
  app.on("url", (d) => {
    if (!view) return;
    if (d?.from === "params") view.url?.syncUrl();
    else view.req?.syncUrl();
  });
  app.on("req", () => {
    view?.req?.badges();
    view?.url?.drawTls();
  });
  app.on("sending", (tab) => {
    if (view && tab === view.tab) {
      view.url?.drawSend();
      view.res?.redraw();
    }
  });
  app.on("response", (tab) => {
    if (view && tab === view.tab) view.res?.redraw();
  });
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let toastTimer;
  app.on("toast", (d) => {
    toast.replaceChildren(
      h(
        `div.as-toast-box.is-${d.kind}`,
        null,
        icon(d.kind === "error" ? "alert" : d.kind === "ok" ? "check" : "info", 15),
        h("span", null, d.text),
      ),
    );
    toast.classList.add("is-shown");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(
      () => toast.classList.remove("is-shown"),
      d.kind === "error" ? 5000 : 2600,
    );
  });

  // ── keys ────────────────────────────────────────────────────────────────
  doc.addEventListener("keydown", (event) => {
    const mod = event.metaKey || event.ctrlKey;
    const tab = app.current();
    const key = event.key.toLowerCase();
    /** @type {Record<string, (() => void) | undefined>} */
    const shortcuts = {
      enter: tab && (() => S.send(tab)),
      s: tab && (() => S.save(tab)),
      t: () => app.blank(),
      w: tab && (() => S.closeTab(tab)),
      l: tab && (() => S.focusUrl()),
      b: () => app.layout({ side: !app.state.layout.side }),
    };
    const run = mod && !event.altKey ? shortcuts[key] : undefined;
    if (run) {
      event.preventDefault();
      run();
    } else if (event.key === "Escape" && tab?.running) S.cancel(tab);
    else if (mod && event.altKey && /^Arrow(Left|Right)$/.test(event.key)) {
      const list = app.state.tabs;
      const at = list.findIndex((t) => t.id === app.state.active);
      const next = list[(at + (event.key === "ArrowRight" ? 1 : list.length - 1)) % list.length];
      if (next) app.activate(next.id);
    }
  });
  doc.addEventListener("scroll", closeMenus, true);

  return {
    S,
    tabs,
    side,
    redraw: drawWork,
    /** Load what lives in the store, then draw. */
    async start() {
      try {
        const kept = await ctx.bridge.call("store.get", { key: "history" });
        if (Array.isArray(kept?.value)) app.setHistory(kept.value);
      } catch {
        /* no store: the history lives for this session only */
      }
      await S.collections.start();
      await S.envs.start();
      await auth.start();
      app.on("history", () => {
        if (!S.settings.history) return;
        void ctx.bridge
          .call("store.set", { key: "history", value: fitHistory(app.state.history) })
          .catch(() => {});
      });
      drawWork();
    },
  };
}

/** The history as it is stored: the newest entries that fit in the store's 64 KiB, with no secret typed as is. @param {import("./app.js").HistoryEntry[]} list */
export function fitHistory(list) {
  const out = [];
  let size = 2;
  for (const listed of list) {
    const req = listed.req ? withoutLiterals(listed.req) : undefined;
    const entry = req ? { ...listed, req, url: req.url } : listed;
    const n = JSON.stringify(entry).length + 1;
    if (size + n > 60_000) break;
    size += n;
    out.push(entry);
  }
  return out;
}
