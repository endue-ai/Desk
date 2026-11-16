// The studio's state without DOM: the open tabs (each a request being edited, its saved copy and
// its last response), which one is in front, the history, and the window's layout. Views listen
// for topics and redraw only what a change touches. The tabs and layout live in the surface's
// state; the history in the plugin's store, trimmed to fit.

import { clone, newRequest, normalize, same } from "./model.js";

/**
 * @typedef {import("./model.js").Request} Request
 * @typedef {import("./send.js").Response} Response
 * @typedef {{ id: string, req: Request, saved: string | null, ref?: { collection: string, path: string },
 *   response?: Response, running?: { cancel(): void }, reqTab: string, resTab: string,
 *   kind?: "group" | "env" | "runner", extra?: Record<string, string>,
 *   lastCaptures?: { name: string, value?: string, error?: string }[], received?: number,
 *   results?: import("./features-scripts.js").Results, quiet?: boolean, data?: Record<string, string>,
 *   preview?: boolean, agent?: boolean }} Tab
 *   `agent`: a request an agent wrote itself, which gets no secret variables and no cookies.
 * @typedef {{ id: string, at: number, method: string, url: string, name: string, status: number,
 *   time: number, size: number, error?: string, req: Request }} HistoryEntry
 * @typedef {"tabs" | "tab" | "req" | "url" | "response" | "sending" | "side" | "history" |
 *   "layout" | "env" | "collections" | "toast"} Topic
 */

export const HISTORY_MAX = 150;

/** @param {{ load?(): any, save?(state: any): void }} [persist] */
export function createApp(persist = {}) {
  /** @type {Map<string, Set<(detail?: any) => void>>} */
  const listeners = new Map();
  const saved = persist.load?.() ?? {};
  const state = {
    /** @type {Tab[]} */
    tabs: (Array.isArray(saved.tabs) ? saved.tabs : []).map((/** @type {any} */ t) => ({
      id: String(t.id),
      req: normalize(t.req),
      saved: typeof t.saved === "string" ? t.saved : null,
      ...(t.ref ? { ref: t.ref } : {}),
      ...(t.kind === "group" || t.kind === "env" || t.kind === "runner" ? { kind: t.kind } : {}),
      ...(t.extra ? { extra: t.extra } : {}),
      reqTab: t.reqTab ?? (t.kind === "group" ? "overview" : "params"),
      resTab: t.resTab ?? "body",
    })),
    /** @type {string | null} */
    active: typeof saved.active === "string" ? saved.active : null,
    /** @type {HistoryEntry[]} */
    history: [],
    layout: {
      rail: saved.layout?.rail ?? "collections",
      side: saved.layout?.side !== false,
      sideWidth: Number(saved.layout?.sideWidth) || 280,
      split: saved.layout?.split === "v" ? "v" : "h",
      ratio: Number(saved.layout?.ratio) || 0.5,
      wrap: saved.layout?.wrap === true,
      /** @type {string[]} */
      expanded: Array.isArray(saved.layout?.expanded) ? saved.layout.expanded.map(String) : [],
    },
  };
  if (!state.tabs.some((t) => t.id === state.active)) state.active = state.tabs[0]?.id ?? null;

  /** @param {Topic} topic @param {(detail?: any) => void} fn */
  const on = (topic, fn) => {
    const set = listeners.get(topic) ?? new Set();
    set.add(fn);
    listeners.set(topic, set);
    return () => set.delete(fn);
  };
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let saveTimer;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      persist.save?.({
        tabs: state.tabs.map((t) => ({
          id: t.id,
          req: t.req,
          saved: t.saved,
          ref: t.ref,
          kind: t.kind,
          extra: t.extra,
          reqTab: t.reqTab,
          resTab: t.resTab,
        })),
        active: state.active,
        layout: state.layout,
      });
    }, 250);
  };
  /** @param {Topic} topic @param {any} [detail] */
  const emit = (topic, detail) => {
    for (const fn of listeners.get(topic) ?? []) fn(detail);
    if (topic !== "toast" && topic !== "sending") save();
  };

  const current = () => state.tabs.find((t) => t.id === state.active);

  /**
   * Open a request (or a folder's settings) in a tab: the tab that already shows it, or a new one.
   * @param {Request} req @param {Tab["ref"]} [ref] @param {{ saved?: boolean, kind?: "group" | "env" | "runner" }} [options]
   */
  const open = (req, ref, options = { saved: true }) => {
    const existing =
      ref &&
      state.tabs.find(
        (t) =>
          t.ref?.collection === ref.collection &&
          t.ref?.path === ref.path &&
          (t.kind ?? "") === (options.kind ?? ""),
      );
    if (existing) {
      state.active = existing.id;
      emit("tab");
      return existing;
    }
    /** @type {Tab} */
    const tab = {
      id: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      req: clone(req),
      saved: ref && options.saved ? JSON.stringify(req) : null,
      ...(ref ? { ref } : {}),
      ...(options.kind ? { kind: options.kind } : {}),
      reqTab: options.kind === "group" ? "overview" : options.kind === "env" ? "vars" : "params",
      resTab: "body",
    };
    const at = state.tabs.findIndex((t) => t.id === state.active);
    state.tabs.splice(at + 1, 0, tab);
    state.active = tab.id;
    emit("tabs");
    emit("tab");
    return tab;
  };

  /** @param {string} id */
  const close = (id) => {
    const at = state.tabs.findIndex((t) => t.id === id);
    if (at < 0) return;
    state.tabs[at]?.running?.cancel();
    state.tabs.splice(at, 1);
    if (state.active === id)
      state.active = state.tabs[Math.min(at, state.tabs.length - 1)]?.id ?? null;
    emit("tabs");
    emit("tab");
  };

  /** Whether a tab differs from what was saved (a tab never saved counts once it has a URL). @param {Tab} tab */
  const dirty = (tab) => {
    if (tab.saved === null) return tab.req.url.trim() !== "" && !!tab.ref;
    return !same(JSON.parse(tab.saved), tab.req);
  };

  /** @param {HistoryEntry[]} list */
  const setHistory = (list) => {
    state.history = list.slice(0, HISTORY_MAX);
    emit("history");
  };

  /** Add a sent request to the history, newest first. @param {Tab} tab @param {Response} res */
  const remember = (tab, res) => {
    /** @type {HistoryEntry} */
    const entry = {
      id: `h${res.at.toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      at: res.at,
      method: tab.req.method,
      url: tab.req.url,
      name: tab.req.name,
      status: res.status,
      time: Math.round(res.timings.total),
      size: res.size,
      ...(res.error ? { error: res.error } : {}),
      req: clone(tab.req),
    };
    setHistory([entry, ...state.history]);
    return entry;
  };

  return {
    state,
    on,
    emit,
    current,
    open,
    close,
    dirty,
    setHistory,
    remember,
    /** A new, empty request in its own tab. */
    blank: (/** @type {Partial<Request>} */ over = {}) =>
      open(newRequest({ name: "Untitled request", ...over })),
    /** @param {string} id */
    activate(id) {
      if (state.active === id) return;
      state.active = id;
      emit("tab");
    },
    /** Move a tab to another place in the strip. @param {string} id @param {number} to */
    move(id, to) {
      const at = state.tabs.findIndex((t) => t.id === id);
      if (at < 0) return;
      const [tab] = state.tabs.splice(at, 1);
      if (tab) state.tabs.splice(Math.max(0, Math.min(state.tabs.length, to)), 0, tab);
      emit("tabs");
    },
    /** Close every tab but one (or all when none is given). @param {string} [keep] */
    closeOthers(keep) {
      for (const t of state.tabs) if (t.id !== keep) t.running?.cancel();
      state.tabs = state.tabs.filter((t) => t.id === keep);
      state.active = keep ?? null;
      emit("tabs");
      emit("tab");
    },
    /** @param {Partial<typeof state.layout>} patch */
    layout(patch) {
      Object.assign(state.layout, patch);
      emit("layout");
    },
    /** A short message at the bottom of the window. @param {string} text @param {"ok" | "error" | "info"} [kind] */
    toast(text, kind = "info") {
      emit("toast", { text, kind });
    },
  };
}

/** @typedef {ReturnType<typeof createApp>} App */
