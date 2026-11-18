// A desk for the Browser's behaviour (ui/browser.js): it records every call, answers web.open
// with a new view, holds the grants or not, answers web.read with a page and plays web.changed;
// and a view that records what it was told to show.
import type { createBrowser } from "../ui/browser.js";

type Desk = Parameters<typeof createBrowser>[0];
type View = Parameters<typeof createBrowser>[1];
type Shows = Parameters<View["shows"]>[0];

export interface FakeDesk extends Desk {
  calls: Array<{ method: string; params: Record<string, unknown> }>;
  asked: string[];
  /** Play web.changed for a view. */
  changed(data: Record<string, unknown>): void;
  of(method: string): Array<Record<string, unknown>>;
}

/** A page as web.read answers it. */
export const PAGE = {
  url: "https://home.example/",
  title: "Home",
  text: '# Home\n[e1 link "Docs"]\n[e2 field "Search" = ""] [e3 button "Go"]',
  from: 0,
  length: 58,
  scroll: { x: 0, y: 0, width: 800, height: 559, pageWidth: 800, pageHeight: 2400 },
};

export function fakeDesk(
  options: {
    granted?: boolean;
    /** Whether the plugin holds web:control (read and act in pages); true by default. */
    control?: boolean;
    allow?: boolean;
    /** What web.read answers. */
    page?: Record<string, unknown>;
    /** What web.act answers. */
    acted?: Record<string, unknown>;
    fail?: Record<string, string>;
    settings?: Record<string, unknown>;
    init?: Record<string, unknown>;
    restored?: unknown;
  } = {},
): FakeDesk {
  let granted = options.granted ?? true;
  let control = options.control ?? true;
  let views = 0;
  const denied = () => Object.assign(new Error("permission_denied"), { code: "permission_denied" });
  const listeners: Array<(event: { event: string; data: unknown }) => void> = [];
  const desk: FakeDesk = {
    calls: [],
    asked: [],
    restored: options.restored,
    async call(method, params) {
      desk.calls.push({ method, params: params as Record<string, unknown> });
      const code = options.fail?.[method];
      if (code) throw Object.assign(new Error(code), { code });
      if (method === "init.get") return { settings: options.init ?? {} };
      if ((method === "web.open" || method === "web.load") && !granted) throw denied();
      if ((method === "web.read" || method === "web.act") && !control) throw denied();
      if (method === "web.open") return { viewId: `w-${++views}` };
      if (method === "web.read") return { ...PAGE, ...options.page };
      if (method === "web.act") return options.acted ?? {};
      return {};
    },
    onEvent(listener) {
      listeners.push(listener);
      return () => {};
    },
    async ask(permission, reason) {
      desk.asked.push(reason);
      const allow = options.allow ?? true;
      if ((permission as { permission?: string }).permission === "web:control") control = allow;
      else granted = allow;
      return { granted: allow };
    },
    async setting(key) {
      return options.settings?.[key];
    },
    changed: (data) => {
      for (const listener of listeners) listener({ event: "web.changed", data });
    },
    of: (method) => desk.calls.filter((c) => c.method === method).map((c) => c.params),
  };
  return desk;
}

export interface RecordingView extends View {
  shown: Shows[];
  notes: string[];
  at: { x: number; y: number; width: number; height: number };
}

export function recordingView(): RecordingView {
  const view: RecordingView = {
    shown: [],
    notes: [],
    at: { x: 0, y: 41, width: 800, height: 559 },
    shows: (state) => view.shown.push(state),
    note: (text) => view.notes.push(text),
    box: () => view.at,
  };
  return view;
}

/** Let every pending promise run. */
export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
