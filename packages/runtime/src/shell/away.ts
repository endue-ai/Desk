/**
 * The desk's chrome goes away while a window fills the whole app (ADR 0221): the agent bar, the
 * rail, the strip under the canvas map, the profile switcher, the desktops, Eris, the talk pill and
 * the running work each slide out past the app's edge, and the window has the app to itself. The
 * account bar, bottom left, stays alone (ADR 0253). What went past an edge comes back while the
 * pointer is at that edge of the app (the compositor says so where a window's page has the pointer,
 * `edges`; this page's own pointer says so where it hears it), while the pointer or the keyboard's
 * focus is on it, and while something of it is open; it goes again `LEAVE_MS` after none of these
 * holds. The slide is CSS's (`away.css`): reduced motion zeroes its time.
 */
import { windowsOf } from "./actions";
import type { ShellCtx } from "./context";
import { listen } from "./dom";
import type { DeskState, Popover } from "./state";

export type Edge = "left" | "right" | "top" | "bottom";
const EDGES: readonly Edge[] = ["left", "right", "top", "bottom"];

/** How near an edge of the app the pointer brings back what slid out past it, in CSS pixels: the
 * compositor's band is the same (`compositor_window/edges.rs`). */
export const BAND = 10;
/** How long nothing holds a part before it goes again: the time to cross from the edge to it. */
export const LEAVE_MS = 400;
/** How far past the edge a part stops, clear of its shadow. */
const PAST = 16;

/** What slides out, and past which edge: `nearest` is the top or the bottom, whichever the part
 * (Eris, the talk pill: the person puts them where they like) is nearer. */
const PARTS: ReadonlyArray<readonly [selector: string, side: Edge | "nearest"]> = [
  ['[data-layer="system"] .sidebar', "left"],
  [".rail", "right"],
  // The map's strip with its Drawer and origin buttons: the compositor slides the map by its shift.
  [".map-strip", "right"],
  ['[data-layer="system"] .modes', "top"],
  ['[data-layer="system"] .desktops', "top"],
  [".eris", "nearest"],
  [".bottom > .composer", "nearest"],
  [".bottom > .running", "bottom"],
];

/** The popovers that belong to each edge's parts: one open keeps its part in sight. */
const OPEN: Record<Edge, readonly Popover[]> = {
  left: ["agents-more"],
  right: ["brain", "sees", "tasks", "desks", "vm", "listen", "arrange", "drawer"],
  top: ["mode-menu", "desktop-menu", "desktops-overview"],
  bottom: [],
};

/** Whether a window fills the whole app on the desktop in front. */
export const filled = (s: DeskState) => windowsOf(s).some((p) => p.fill === "full");

/** The edges of a `w`×`h` app the point is within `BAND` of. */
export function bandOf(x: number, y: number, w: number, h: number): Edge[] {
  const at: Edge[] = [];
  if (x < BAND) at.push("left");
  if (x >= w - BAND) at.push("right");
  if (y < BAND) at.push("top");
  if (y >= h - BAND) at.push("bottom");
  return at;
}

/** An element's `translate` as it is drawn now, in pixels. */
function shift(el: HTMLElement): [number, number] {
  const said = el.ownerDocument.defaultView?.getComputedStyle(el).translate ?? "";
  const [x = 0, y = 0] = said.split(" ").map((v) => Number.parseFloat(v) || 0);
  return [x, y];
}

export function mountAway(root: HTMLElement, ctx: ShellCtx): () => void {
  const win = root.ownerDocument.defaultView ?? window;
  /** The edges whose parts show; a timer while one is about to go. */
  const shown = new Map<Edge, number | undefined>();
  /** The edges this page's own pointer is at, and the part it is on. */
  let own: Edge[] = [];
  let over: Edge | null = null;
  let away = false;

  const parts = () =>
    PARTS.flatMap(([selector, side]) => {
      const el = root.querySelector<HTMLElement>(selector);
      return el ? [{ el, side }] : [];
    });
  const edgeOf = (el: Element | null) =>
    (el?.closest<HTMLElement>("[data-away]")?.dataset.away as Edge | undefined) ?? null;

  /** Name the edge `el` goes past and how far, from where it rests. */
  const place = (el: HTMLElement, side: Edge | "nearest") => {
    const r = el.getBoundingClientRect();
    const [dx, dy] = shift(el);
    const [left, top] = [r.left - dx, r.top - dy];
    const [vw, vh] = [win.innerWidth, win.innerHeight];
    const edge = side === "nearest" ? (top + r.height / 2 < vh / 2 ? "top" : "bottom") : side;
    const x = edge === "left" ? -(left + r.width + PAST) : edge === "right" ? vw - left + PAST : 0;
    const y = edge === "top" ? -(top + r.height + PAST) : edge === "bottom" ? vh - top + PAST : 0;
    el.dataset.away = edge;
    el.style.setProperty("--away-x", `${Math.round(x)}px`);
    el.style.setProperty("--away-y", `${Math.round(y)}px`);
  };

  /** Whether something keeps `edge`'s parts in sight. */
  const holds = (edge: Edge, s: DeskState): boolean => {
    if (s.edges.includes(edge) || own.includes(edge) || over === edge) return true;
    if (edgeOf(root.querySelector(":focus-visible")) === edge) return true;
    if (s.popover !== null && OPEN[edge].includes(s.popover)) return true;
    // Eris at work and the talk line open stay in sight wherever the person put them.
    const eris = edgeOf(root.querySelector(".eris"));
    if (eris === edge && (s.eris.state !== "idle" || s.eris.saying !== "")) return true;
    return edgeOf(root.querySelector(".bottom > .composer")) === edge && s.composer.open;
  };

  const apply = () => {
    for (const { el } of parts()) {
      el.classList.toggle("is-out", away && !shown.has(el.dataset.away as Edge));
    }
  };

  const update = () => {
    const s = ctx.store.get();
    away = filled(s);
    root.classList.toggle("is-away", away);
    if (!away) {
      for (const timer of shown.values()) win.clearTimeout(timer);
      shown.clear();
      return apply();
    }
    // Where each part rests can change while it is in sight: Eris dragged, the app resized.
    for (const { el, side } of parts()) {
      if (!el.classList.contains("is-out")) place(el, side);
    }
    for (const edge of EDGES) {
      if (holds(edge, s)) {
        win.clearTimeout(shown.get(edge));
        shown.set(edge, undefined);
      } else if (shown.has(edge) && shown.get(edge) === undefined) {
        const timer = win.setTimeout(() => {
          shown.delete(edge);
          apply();
        }, LEAVE_MS);
        shown.set(edge, timer);
      }
    }
    apply();
  };
  update();

  const offs = [
    ctx.store.watch(
      (s) => [filled(s), s.edges, s.popover, s.composer.open, s.eris.state, s.eris.saying],
      update,
    ),
    listen(root, "pointermove", (e) => {
      const { clientX, clientY } = e as PointerEvent;
      const at = bandOf(clientX, clientY, win.innerWidth, win.innerHeight);
      const on = edgeOf(e.target as Element | null);
      if (at.join() === own.join() && on === over) return;
      own = at;
      over = on;
      update();
    }),
    // The pointer left the page: for a window's page in the app, or for outside it.
    listen(root.ownerDocument.documentElement, "pointerleave", () => {
      if (own.length === 0 && over === null) return;
      own = [];
      over = null;
      update();
    }),
    listen(root, "focusin", update),
    listen(root, "focusout", update),
    listen(win, "resize", update),
  ];
  return () => {
    for (const off of offs) off();
    for (const timer of shown.values()) win.clearTimeout(timer);
    root.classList.remove("is-away");
    for (const { el } of parts()) {
      el.classList.remove("is-out");
      delete el.dataset.away;
      el.style.removeProperty("--away-x");
      el.style.removeProperty("--away-y");
    }
  };
}
