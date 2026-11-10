// Compositor mode (#52): every plugin surface renders in an off-screen browser of its own, and the
// desk's compositor draws it where the runtime placed its frame. The runtime still lays the windows
// out here (#53 moves that to Rust), so this page tells the shell, on each frame something changed,
// where every plugin frame is: its layout size, its box on the page, the parts of it nothing covers
// (`compositor-visible.ts`) and whether the runtime unloaded it. Each frame holds a transparent
// stand-in (the CEF shell's `stand_in.html`) that takes the plugin page's colour scheme, so what
// shows under a transparent page is what showed under the frame.
import {
  type Box,
  type Geometry,
  type Hit,
  intersect,
  paintsIn,
  screenHits,
  visiblePieces,
} from "./compositor-visible";

/** One plugin surface's frame, as `compositor_window/layout.rs` reads it. */
export interface PlacedSurface {
  host: string;
  src: string;
  loads: number;
  size: { width: number; height: number };
  rect: Box;
  pieces: Box[];
  asleep: boolean;
}

export interface LayoutReport {
  seq: number;
  scale: number;
  surfaces: PlacedSurface[];
}

/** The plugin surface host of a frame's URL, `<surface>.<plugin label>`, if it is one. */
export function surfaceHostOf(src: string): string | undefined {
  const match = /^desk-plugin:\/\/([^/?#:]+)/.exec(src);
  const host = match?.[1];
  return host && host !== "localhost" && host.includes(".") ? host : undefined;
}

/** The part of `element` its ancestors' overflow and the viewport leave, in page pixels. */
function clipOf(element: Element, win: Window): Box | undefined {
  let clip = intersect(element.getBoundingClientRect(), {
    x: 0,
    y: 0,
    width: win.innerWidth,
    height: win.innerHeight,
  });
  for (let el = element.parentElement; el && clip; el = el.parentElement) {
    const style = win.getComputedStyle(el);
    if (style.overflowX === "visible" && style.overflowY === "visible") continue;
    clip = intersect(clip, el.getBoundingClientRect());
  }
  return clip;
}

/** The page grid's spacing: thinner than any bar or title bar. */
const GRID = 24;

const round = (n: number) => Math.round(n * 100) / 100;
const boxOf = (r: Box): Box => ({
  x: round(r.x),
  y: round(r.y),
  width: round(r.width),
  height: round(r.height),
});

/** Report the plugin frames' places through `send` whenever they change; returns the function that stops. */
export function startCompositorLayout(
  win: Window,
  send: (report: LayoutReport) => void,
): () => void {
  const doc = win.document;
  const loads = new WeakMap<HTMLIFrameElement, number>();
  /** Each section's last frame, so an unloaded one is still named. */
  const last = new Map<string, { host: string; src: string; loads: number }>();
  const geometry: Geometry = {
    stack: (x, y) => doc.elementsFromPoint?.(x, y) ?? [],
    // Where its ancestors' overflow lets it show (a long list scrolled in a window).
    box: (element) => clipOf(element, win) ?? { x: 0, y: 0, width: 0, height: 0 },
    paints: (element) => paintsIn(win, element),
  };
  let seq = 0;
  let sent = "";
  let frame = 0;
  // The page's own changes (windows moved, menus opened) make the grid stale; a still page costs
  // no hit tests. Frames that glide (a transition) move without a mutation; and once a second,
  // whatever happened.
  let stale = true;
  let hits: Hit[] = [];
  let rects = "";
  let looked = 0;
  const observer = new MutationObserver(() => {
    stale = true;
  });
  observer.observe(doc.documentElement, { subtree: true, childList: true, attributes: true });
  const onResize = () => {
    stale = true;
  };
  win.addEventListener("resize", onResize);
  const look = (now: number) => {
    frame = win.requestAnimationFrame(look);
    const frames = [...doc.querySelectorAll<HTMLIFrameElement>("iframe")];
    const where = frames.map((f) => JSON.stringify(f.getBoundingClientRect())).join();
    if (stale || where !== rects || now - looked > 1000) {
      stale = false;
      rects = where;
      looked = now;
      hits = screenHits(win.innerWidth, win.innerHeight, GRID, geometry);
    }
    const surfaces: PlacedSurface[] = [];
    const seen = new Set<string>();
    for (const iframe of frames) {
      const host = surfaceHostOf(iframe.src);
      if (!host) continue;
      if (!loads.has(iframe)) {
        loads.set(iframe, 0);
        iframe.addEventListener("load", () => loads.set(iframe, (loads.get(iframe) ?? 0) + 1));
      }
      const count = loads.get(iframe) ?? 0;
      const section = iframe.closest<HTMLElement>("[data-surface]");
      if (section?.dataset.surface)
        last.set(section.dataset.surface, { host, src: iframe.src, loads: count });
      seen.add(host);
      const clip = iframe.isConnected && !section?.hidden ? clipOf(iframe, win) : undefined;
      surfaces.push({
        host,
        src: iframe.src,
        loads: count,
        size: { width: iframe.clientWidth, height: iframe.clientHeight },
        rect: boxOf(iframe.getBoundingClientRect()),
        pieces: clip ? visiblePieces(iframe, clip, geometry, hits).map(boxOf) : [],
        asleep: false,
      });
    }
    const sections = [...doc.querySelectorAll<HTMLElement>("[data-surface]")];
    for (const [id, known] of last) {
      if (seen.has(known.host)) continue;
      const section = sections.find((s) => s.dataset.surface === id);
      if (!section) {
        last.delete(id);
        continue;
      }
      const rect = boxOf(section.getBoundingClientRect());
      surfaces.push({
        ...known,
        size: { width: rect.width, height: rect.height },
        rect,
        pieces: [],
        asleep: true,
      });
    }
    const body = JSON.stringify({ scale: win.devicePixelRatio, surfaces });
    if (body === sent) return;
    sent = body;
    send({ seq: ++seq, scale: win.devicePixelRatio, surfaces });
  };
  frame = win.requestAnimationFrame(look);
  return () => {
    win.cancelAnimationFrame(frame);
    observer.disconnect();
    win.removeEventListener("resize", onResize);
  };
}
