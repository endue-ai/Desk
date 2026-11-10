// Compositor mode (#81, ADR 0151): the CEF shell's compositor draws every window from the window
// manager's model (crates/desk-wm), which this page feeds until #83 moves the window manager there.
// Whenever the desk changed it sends `compositor_desk`: the desk the runtime keeps (`wmDesk`), each
// plugin frame's document and state with what its window says while it has no live frame, the
// titles of the shell's own views, the top chips' edges and the live budget's settings, and the
// window manager's seam (ADR 0153): the last of desk-wm's changes the runtime took and the window
// the page lays out where a gesture holds it (`compositor-wm.ts`). It hears back the windows that
// keep a live frame (`desk://compositor-live`), which the runtime's frame policy then carries out
// (`keptWindows`). The page itself draws only its system layer and its own views;
// `compositor.css` leaves the rest to the compositor.
import type { Desk, KeptWindows } from "@endue-ai/runtime";
import { wmDesk, wmTitles } from "@endue-ai/runtime";

export type FrameState = "live" | "asleep" | "late" | "stopped";

/** What a window says where its plugin has no live frame. */
export interface Card {
  title: string;
  line: string;
  actions: string[];
}

/** One plugin surface's frame, as `compositor_window/report.rs` reads it. */
export interface FrameReport {
  plugin: string;
  host: string;
  src: string;
  loads: number;
  state: FrameState;
  card?: Card;
  /** A surface of the page's own system layer (an overlay, an edge bar): where the page puts it. */
  place?: Place;
}

/** Where the page lays a surface out itself, in CSS pixels, and whether it shows. */
export interface Place {
  x: number;
  y: number;
  width: number;
  height: number;
  shown: boolean;
}

export interface DeskReport {
  seq: number;
  width: number;
  height: number;
  desk: unknown;
  frames: FrameReport[];
  titles: Record<string, string>;
  top: { left?: number; right?: number };
  budget: { live: number; afterMs: number };
  copy: { crashed: string; loading: string };
  /** The last of desk-wm's changes the runtime took. */
  applied: number;
  /** The window the page lays out where desk-wm's gesture holds it. */
  held?: Held;
}

/** Where the page lays a held window out, in CSS pixels. */
export interface Held {
  window: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What the window manager's seam adds to each report. */
export interface WmState {
  applied: number;
  held?: Held;
}

/**
 * A running report: stop it, or send what changed now (before a window command, say) and answer
 * the sequence number of the last report sent.
 */
export type CompositorDesk = (() => void) & { flush(): number };

/** The compositor's own placeholders, in the desk's language. */
const COPY = {
  ko: { crashed: "멈춰서 다시 불러오는 중입니다.", loading: "불러오는 중…" },
  en: { crashed: "It stopped working and is loading again.", loading: "Loading…" },
} as const;

/** The plugin surface host of a frame's URL, `<surface>.<plugin label>`, if it is one. */
export function surfaceHostOf(src: string): string | undefined {
  const match = /^desk-plugin:\/\/([^/?#:]+)/.exec(src);
  const host = match?.[1];
  return host && host !== "localhost" && host.includes(".") ? host : undefined;
}

/** The set the shell sends, as the runtime's window host reads it; undefined until the first. */
export function keptWindows(): KeptWindows & { set(ids: readonly string[]): void } {
  let kept: Set<string> | undefined;
  const listeners = new Set<() => void>();
  return {
    kept: () => kept,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(ids) {
      kept = new Set(ids);
      for (const listener of [...listeners]) listener();
    },
  };
}

const texts = (root: Element | null, selector: string) =>
  [...(root?.querySelectorAll(selector) ?? [])].map((el) => el.textContent?.trim() ?? "");

/** What the page shows over or instead of a frame: a placeholder, or Not responding. */
export function cardOf(section: Element | null, state: FrameState): Card | undefined {
  if (!section || state === "live") return undefined;
  if (state === "late") {
    const asking = section.querySelector(".desk-not-responding");
    if (!asking) return undefined;
    const [title = "", line = ""] = texts(asking, "p");
    return { title, line, actions: texts(asking, "button") };
  }
  const stand = section.querySelector(".desk-surface-placeholder");
  if (!stand) return undefined;
  const [title = "", line = ""] = texts(stand, "p");
  return { title, line, actions: texts(stand, "button") };
}

/** A `--chrome-*` inset of the windows' layer in pixels, if it is measured. */
function inset(layer: HTMLElement | null, name: string): number | undefined {
  const value = Number.parseFloat(layer?.style.getPropertyValue(name) ?? "");
  return Number.isFinite(value) ? value : undefined;
}

/** Send the desk through `send` whenever it changes; returns the function that stops. */
export function startCompositorDesk(
  win: Window,
  desk: Pick<Desk, "store" | "runtime">,
  send: (report: DeskReport) => void,
  wm: () => WmState = () => ({ applied: 0 }),
): CompositorDesk {
  const doc = win.document;
  doc.documentElement.classList.add("desk-compositor");
  const loads = new WeakMap<HTMLIFrameElement, number>();
  /** Each plugin's last frame, so one whose frame is away is still named. */
  const last = new Map<string, { host: string; src: string; loads: number }>();
  const { frames, settings } = desk.runtime;
  const lang = desk.store.get().lang === "ko" ? "ko" : "en";
  let seq = 0;
  let sent = "";
  let frame = 0;
  const stateOf = (id: string): FrameState => {
    const said = frames.state(id);
    if (said === "stopped") return "stopped";
    if (frames.asleep(id)) return "asleep";
    return said === "late" ? "late" : "live";
  };
  const report = () => {
    /** The surfaces the page lays out itself, outside every window. */
    const own: FrameReport[] = [];
    for (const iframe of doc.querySelectorAll<HTMLIFrameElement>(".desk-surface iframe")) {
      const host = surfaceHostOf(iframe.src);
      const section = iframe.closest<HTMLElement>("[data-surface]");
      const plugin = section?.dataset.surface;
      if (!host || !plugin) continue;
      if (!loads.has(iframe)) {
        loads.set(iframe, 0);
        iframe.addEventListener("load", () => loads.set(iframe, (loads.get(iframe) ?? 0) + 1));
      }
      const known = { host, src: iframe.src, loads: loads.get(iframe) ?? 0 };
      if (iframe.closest(".surface")) {
        last.set(plugin, known);
        continue;
      }
      const r = iframe.getBoundingClientRect();
      const shown = iframe.isConnected && !section?.closest("[hidden]");
      const place = {
        x: r.x,
        y: r.y,
        width: iframe.clientWidth,
        height: iframe.clientHeight,
        shown,
      };
      own.push({ plugin, ...known, state: stateOf(plugin), place });
    }
    const s = desk.store.get();
    const held = new Set(s.adopted.map((a) => a.id));
    for (const id of last.keys()) if (!held.has(id)) last.delete(id);
    const reports: FrameReport[] = [];
    // Every window the runtime handed over, its frame's state with it: one whose frame the page
    // never showed has no document yet, and the shell makes its surface once it has.
    for (const { id: plugin } of s.adopted) {
      const known = last.get(plugin) ?? { host: "", src: "", loads: 0 };
      const state = stateOf(plugin);
      // The runtime's own section (its window is named after it too, in a slot).
      const section = doc.querySelector(`.desk-surface[data-surface="${plugin}"]`);
      const card = cardOf(section, state);
      reports.push({ plugin, ...known, state, ...(card ? { card } : {}) });
    }
    reports.push(...own.filter((f) => !held.has(f.plugin)));
    const layer = doc.querySelector<HTMLElement>(".surfaces");
    const left = inset(layer, "--chrome-left");
    const right = inset(layer, "--chrome-right");
    const live = settings.get<unknown>("desk.surfaces.live", 8);
    const after = settings.get<unknown>("desk.display.unload-after", 300);
    const body = {
      width: win.innerWidth,
      height: win.innerHeight,
      desk: wmDesk(s),
      frames: reports,
      titles: wmTitles(desk.store),
      top: { ...(left === undefined ? {} : { left }), ...(right === undefined ? {} : { right }) },
      budget: {
        live: typeof live === "number" && live >= 0 ? Math.floor(live) : 8,
        afterMs: typeof after === "number" && after >= 0 ? after * 1000 : 0,
      },
      copy: COPY[lang],
      ...wm(),
    };
    const json = JSON.stringify(body);
    if (json === sent) return seq;
    sent = json;
    send({ seq: ++seq, ...body });
    return seq;
  };
  const look = () => {
    frame = win.requestAnimationFrame(look);
    report();
  };
  frame = win.requestAnimationFrame(look);
  const stop = () => {
    win.cancelAnimationFrame(frame);
    doc.documentElement.classList.remove("desk-compositor");
  };
  return Object.assign(stop, { flush: report });
}
