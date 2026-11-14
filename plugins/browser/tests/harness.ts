// A desk for the Browser's behaviour (ui/browser.js): it records every call, answers web.open
// with a new view, holds the grant or not, and plays web.changed; and a view that records what it
// was told to show.
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

export function fakeDesk(
  options: {
    granted?: boolean;
    allow?: boolean;
    fail?: Record<string, string>;
    settings?: Record<string, unknown>;
    init?: Record<string, unknown>;
    restored?: unknown;
  } = {},
): FakeDesk {
  let granted = options.granted ?? true;
  let views = 0;
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
      if ((method === "web.open" || method === "web.load") && !granted)
        throw Object.assign(new Error("permission_denied"), { code: "permission_denied" });
      if (method === "web.open") return { viewId: `w-${++views}` };
      return {};
    },
    onEvent(listener) {
      listeners.push(listener);
      return () => {};
    },
    async ask(_permission, reason) {
      desk.asked.push(reason);
      granted = options.allow ?? true;
      return { granted };
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
