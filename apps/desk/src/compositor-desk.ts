// The page's report (#81, ADR 0151, ADR 0160): the CEF shell's compositor draws every window from the
// window manager (crates/desk-wm), which holds the desk (#83). Whenever what only the page knows
// changed it sends `compositor_desk`: each plugin surface's document, load count and state with what
// its window says while it has no live page (the runtime's surface pages, never a frame here), the
// places of the system layer's own plugin surfaces (overlays, the dock) and parts, the titles of the
// shell's own views, the top chips' edges and the live budget's settings, the words of what the
// compositor draws itself (placeholders, the spread, the canvas map), whether the map is folded and
// how wide (#54), each view's icon, which it draws in the map's windows (ADR 0273), the windows
// Eris is at, which glow (ADR 0271), and the window manager's seam (ADR 0153): the last desk
// desk-wm published that the page took and the window the page lays out where a gesture holds it
// (`compositor-wm.ts`). The page
// itself draws only its system layer and its own views; `compositor.css` leaves the rest to the
// compositor. It looks on every frame while the desk changes, and stops after `QUIET` frames that
// changed nothing (ADR 0164): a change to the page, a new size, the compositor's word (`wake`) or a
// look every `SAFETY_MS` start it again, so a desk at rest runs no frame loop here.
import { messageText } from "@endue-ai/bridge";
import type { Desk, RemotePages, RemoteSurface } from "@endue-ai/runtime";
import { spreadCopy, viewIcons, viewTitles } from "@endue-ai/runtime";
import { type PartReport, systemParts } from "./compositor-system";
import en from "./messages/en.json";
import ko from "./messages/ko.json";

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

/**
 * Where the page lays a surface of its system layer out, in CSS pixels, whether it shows, and its
 * layer: an edge bar lies under the system layer's own parts (`edge`), an overlay over them; `z`
 * stacks it in its layer as the page does (an overlay shown later is raised above the others).
 */
export interface Place {
  x: number;
  y: number;
  width: number;
  height: number;
  shown: boolean;
  layer: "edge" | "overlay";
  z: number;
}

export interface DeskReport {
  seq: number;
  width: number;
  height: number;
  frames: FrameReport[];
  /** The parts of the system layer the page shows, drawn whole above every window (ADR 0160). */
  parts: PartReport[];
  titles: Record<string, string>;
  /** Each view's icon as SVG path data, what the compositor draws in the map's windows (ADR 0273). */
  icons: Record<string, string>;
  top: { left?: number; right?: number };
  budget: { live: number; afterMs: number };
  copy: {
    crashed: string;
    loading: string;
    /** The spread's words and the canvas map's, which the compositor draws (#54). */
    spread: Record<string, string>;
    map: { label: string; show: string; fold: string };
  };
  /** The canvas map folded to its button and its width once resized, as the session keeps them;
   * gone with the strip under it while a window fills the app, `shift` pixels toward the edge or
   * `away` (ADR 0221, ADR 0253, ADR 0273). */
  map: { folded: boolean; width?: number; shift?: number; away?: true };
  /**
   * The windows Eris looks at or uses now, each with how brightly its frame glows, 0 to 1: the
   * compositor draws the glow around the window where it is (ADR 0271).
   */
  lit: { window: string; level: number }[];
  /** The last desk desk-wm published that the page took. */
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

/** A running report: stop it, or send what changed now. */
export type CompositorDesk = (() => void) & {
  flush(): number;
  /** Something the report reads changed outside the page: look on every frame again. */
  wake(): void;
};

/** The compositor's own placeholders and the canvas map's labels, in the desk's language. */
const COPY = { en: placeholders("en"), ko: placeholders("ko") };
function placeholders(lang: "en" | "ko") {
  const say = (key: string) => messageText({ en, ko }, lang, `desk.compositor.${key}`);
  return {
    crashed: say("crashed"),
    loading: say("loading"),
    map: { label: say("mapLabel"), show: say("mapShow"), fold: say("mapFold") },
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

/** A window's plugin the runtime made no surface for yet: nothing to show. */
const NONE = { host: "", src: "", loads: 0 };

/** Where the page lays out a surface of its own system layer, from its place's box. */
function placeOf(p: Pick<RemoteSurface, "view" | "away">): Place {
  const section = p.view.closest<HTMLElement>("[data-surface]");
  const r = p.view.getBoundingClientRect();
  return {
    x: r.x,
    y: r.y,
    width: p.view.clientWidth,
    height: p.view.clientHeight,
    shown: !p.away && p.view.isConnected && !section?.closest("[hidden]"),
    layer: section?.classList.contains("desk-surface--overlay") ? "overlay" : "edge",
    z: Number(section?.style.zIndex) || 0,
  };
}

/** A `--chrome-*` inset of the windows' layer in pixels, if it is measured. */
function inset(layer: HTMLElement | null, name: string): number | undefined {
  const value = Number.parseFloat(layer?.style.getPropertyValue(name) ?? "");
  return Number.isFinite(value) ? value : undefined;
}

/**
 * The canvas map goes with the strip under it while a window fills the whole app (ADR 0221, ADR
 * 0253, `shell/away.ts`): how far the strip has slid toward the edge now, and whether it is out, so
 * map and strip move as one. A page with no strip of its own (a plugin holds the dock's role) has
 * the map go with the right rail, as it did.
 */
function mapAway(doc: Document): { shift?: number; away?: true } {
  const part =
    doc.querySelector<HTMLElement>(".map-strip:not([data-role-yielded])") ??
    doc.querySelector<HTMLElement>(".rail");
  const style = part?.dataset.away === "right" && doc.defaultView?.getComputedStyle(part);
  if (!part || !style) return {};
  const shift = Math.round(Number.parseFloat(style.translate) || 0);
  const away = part.classList.contains("is-out") && style.visibility === "hidden";
  return { ...(shift ? { shift } : {}), ...(away ? { away: true as const } : {}) };
}

/** Frames in a row that changed nothing, after which the page stops looking every frame. */
const QUIET = 30;
/** How often the page looks while it does not look every frame: for what no event says. */
const SAFETY_MS = 1000;

/** Send the desk through `send` whenever it changes; returns the function that stops. */
export function startCompositorDesk(
  win: Window,
  desk: Pick<Desk, "store" | "runtime">,
  pages: Pick<RemotePages, "list">,
  send: (report: DeskReport) => void,
  wm: () => WmState = () => ({ applied: 0 }),
): CompositorDesk {
  const doc = win.document;
  doc.documentElement.classList.add("desk-compositor");
  const { frames, settings } = desk.runtime;
  const lang = desk.store.get().lang;
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
    const s = desk.store.get();
    const held = new Set(s.adopted.map((a) => a.id));
    const surfaces = new Map(pages.list().map((p) => [p.id, p]));
    const reports: FrameReport[] = [];
    // Every window the runtime handed over, its page's state with it: one whose surface the runtime
    // has not made yet has no document, and the shell makes its surface once it has.
    for (const { id: plugin } of s.adopted) {
      const p = surfaces.get(plugin);
      const known = p ? { host: p.host, src: p.src, loads: p.loads } : NONE;
      const state = stateOf(plugin);
      // The runtime's own section (its window is named after it too, in a slot).
      const section = doc.querySelector(`.desk-surface[data-surface="${plugin}"]`);
      const card = cardOf(section, state);
      reports.push({ plugin, ...known, state, ...(card ? { card } : {}) });
    }
    // The surfaces the page lays out itself, outside every window: overlays and edge bars.
    for (const p of surfaces.values()) {
      if (held.has(p.id) || !p.host) continue;
      const known = { host: p.host, src: p.src, loads: p.loads };
      reports.push({ plugin: p.id, ...known, state: stateOf(p.id), place: placeOf(p) });
    }
    const layer = doc.querySelector<HTMLElement>(".surfaces");
    const left = inset(layer, "--chrome-left");
    const right = inset(layer, "--chrome-right");
    const live = settings.get<unknown>("desk.surfaces.live", 8);
    const after = settings.get<unknown>("desk.display.unload-after", 300);
    const body = {
      width: win.innerWidth,
      height: win.innerHeight,
      frames: reports,
      parts: systemParts(doc),
      titles: viewTitles(desk.store),
      icons: viewIcons(desk.store),
      top: { ...(left === undefined ? {} : { left }), ...(right === undefined ? {} : { right }) },
      budget: {
        live: typeof live === "number" && live >= 0 ? Math.floor(live) : 8,
        afterMs: typeof after === "number" && after >= 0 ? after * 1000 : 0,
      },
      copy: { ...COPY[lang], spread: spreadCopy(lang) },
      map: {
        folded: s.mapFolded,
        ...(s.mapWidth === null ? {} : { width: s.mapWidth }),
        ...mapAway(doc),
      },
      lit: s.erisWindows.map(({ id, glow }) => ({ window: id, level: glow })),
      ...wm(),
    };
    const json = JSON.stringify(body);
    if (json === sent) return seq;
    sent = json;
    send({ seq: ++seq, ...body });
    return seq;
  };
  // Frames looked at in a row that changed nothing.
  let quiet = 0;
  const look = () => {
    frame = 0;
    const before = seq;
    report();
    quiet = seq === before ? quiet + 1 : 0;
    if (quiet < QUIET) frame = win.requestAnimationFrame(look);
  };
  const wake = () => {
    quiet = 0;
    if (!frame) frame = win.requestAnimationFrame(look);
  };
  frame = win.requestAnimationFrame(look);
  const changes = new MutationObserver(wake);
  changes.observe(doc.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
  win.addEventListener("resize", wake);
  // A window's glow changes nothing in the page where the compositor draws the windows.
  const offLit = desk.store.watch((s) => s.erisWindows, wake);
  const safety = win.setInterval(() => {
    const before = seq;
    report();
    if (seq !== before) wake();
  }, SAFETY_MS);
  const stop = () => {
    win.cancelAnimationFrame(frame);
    changes.disconnect();
    win.removeEventListener("resize", wake);
    win.clearInterval(safety);
    offLit();
    doc.documentElement.classList.remove("desk-compositor");
  };
  return Object.assign(stop, { flush: report, wake });
}
