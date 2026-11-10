/**
 * The canvas map in the bottom right, beside the arrange strip (ADR 0082): the desktop in front drawn
 * whole, its normal windows and the part in sight, so the person sees where everything lies and goes
 * there. A press centres the view on the point and a drag moves it; the wheel pans as it does over
 * the background; focused, the arrow keys move the view a quarter of itself (Shift: a whole view) and
 * Home brings it back to the start. Floating windows stay in sight whatever the pan, so the map
 * leaves them out. It is there only while the canvas holds something to find, a normal window or a
 * pan away from the start. It folds to one button (kept with the session) that sits clear of the
 * free area, and it folds by itself while a filled window is in sight, so a maximized or snapped
 * window keeps all of itself (#3); the button opens it over that window when the person asks.
 */
import { windowTitle } from "../desktops/map";
import { appSize, isFloating, ORIGIN } from "../surface/coordinates";
import type { Rect } from "../surface/geometry";
import { rectIn } from "../wm/view";
import { windowsOf } from "./actions";
import type { ShellCtx } from "./context";
import { h, listen } from "./dom";
import { draggable } from "./drag";
import { icon } from "./icons";
import {
  type Fit,
  fitWorld,
  MAP,
  panByKey,
  panCentredOn,
  panMovedBy,
  toMap,
  toWorld,
  viewRect,
  worldOf,
} from "./minimap-model";
import { panOf, setPan, wheelPan } from "./Pan";
import type { DeskState } from "./state";

const px = (n: number) => `${Math.round(n * 10) / 10}px`;
const placed = (r: Rect) => ({ left: px(r.x), top: px(r.y), width: px(r.w), height: px(r.h) });

/** The windows the map draws: the normal ones, which the canvas carries. */
const onCanvas = (s: DeskState) => windowsOf(s).filter((p) => !isFloating(p));

/** Whether the canvas holds anything to find: a normal window, or a pan away from the start. */
export function mapShows(s: DeskState): boolean {
  const pan = panOf(s);
  return onCanvas(s).length > 0 || pan.x !== 0 || pan.y !== 0;
}

/** Whether a filled window (maximized or snapped, ADR 0040's free area) is in sight. */
export function fillInSight(s: DeskState, vw: number, vh: number): boolean {
  return windowsOf(s).some((p) => {
    if (!p.fill && !p.restore) return false;
    const r = rectIn(s.wm, p.id);
    return r !== undefined && r.x < vw && r.x + r.w > 0 && r.y < vh && r.y + r.h > 0;
  });
}

export function mountMinimap(root: HTMLElement, ctx: ShellCtx): () => void {
  const map = h("div", {
    class: "minimap-map",
    id: "canvas-map",
    role: "group",
    tabindex: "0",
    "aria-keyshortcuts": "ArrowLeft ArrowRight ArrowUp ArrowDown Home",
    style: { width: `${MAP.w}px`, height: `${MAP.h}px` },
  });
  /** The person opened the map over a filled window; it lasts until no filled window is in sight. */
  let peek = false;
  const covered = (s: DeskState) => {
    const { vw, vh } = appSize();
    return fillInSight(s, vw, vh);
  };
  const open = (s: DeskState) => !s.mapFolded && (peek || !covered(s));
  const fold = h("button", {
    class: "icon-button minimap-fold",
    type: "button",
    "aria-controls": "canvas-map",
    onClick: () => {
      const s = ctx.store.get();
      const over = covered(s);
      if (open(s)) {
        // Folding over a filled window only ends the peek; it opens again once the fill is gone.
        if (over) peek = false;
        else ctx.store.set({ mapFolded: true });
      } else {
        peek = over;
        if (s.mapFolded) ctx.store.set({ mapFolded: false });
      }
      draw();
    },
  });
  const el = h("aside", { class: "minimap", "data-minimap": "" }, map, fold);

  /** How the world sat in the box at the last draw; a drag holds it, so the map stays still. */
  let fit: Fit = fitWorld(viewRect(ORIGIN, MAP.w, MAP.h));
  let held: Fit | null = null;
  let before = ORIGIN;
  let start = ORIGIN;
  let desktop = ctx.store.get().desktop;

  const draw = () => {
    const s = ctx.store.get();
    if (!mapShows(s)) {
      el.remove();
      return;
    }
    if (el.parentElement !== root) root.append(el);
    if (!covered(s)) peek = false;
    const folded = !open(s);
    el.classList.toggle("is-folded", folded);
    map.hidden = folded;
    const label = ctx.tr(folded ? "showMap" : "foldMap");
    fold.replaceChildren(icon(folded ? "map" : "minus", folded ? 18 : 14));
    fold.title = label;
    fold.setAttribute("aria-label", label);
    fold.setAttribute("aria-expanded", String(!folded));
    map.setAttribute("aria-label", ctx.tr("canvasMap"));
    map.title = ctx.tr("canvasMapHint");
    if (folded) return;
    const { vw, vh } = appSize();
    const windows = onCanvas(s);
    const view = viewRect(panOf(s), vw, vh);
    fit = held ?? fitWorld(worldOf(windows, view));
    map.replaceChildren(
      ...windows.map((p) =>
        h("span", {
          class: `minimap-window${p.id === s.focused ? " is-focused" : ""}`,
          "data-window": p.id,
          "aria-hidden": "true",
          title: windowTitle(ctx, s, p),
          style: placed(toMap(p, fit)),
        }),
      ),
      h("span", { class: "minimap-view", "aria-hidden": "true", style: placed(toMap(view, fit)) }),
    );
  };

  const here = () => ctx.store.get().desktop === desktop;
  const off = [
    draggable(map, {
      // A press away from the part in sight takes the view there at once; a drag then moves it.
      accept: (e) => {
        const s = ctx.store.get();
        before = panOf(s);
        desktop = s.desktop;
        if (!(e.target instanceof Element && e.target.closest(".minimap-view"))) {
          const { vw, vh } = appSize();
          const box = map.getBoundingClientRect();
          const at = toWorld(e.clientX - box.left, e.clientY - box.top, fit);
          setPan(ctx, panCentredOn(at, vw, vh));
        }
        return true;
      },
      start: () => {
        held = fit;
        start = panOf(ctx.store.get());
      },
      move: (dx, dy) => {
        if (here() && held) setPan(ctx, panMovedBy(start, dx, dy, held));
      },
      end: (dx, dy) => {
        if (here() && held) setPan(ctx, panMovedBy(start, dx, dy, held));
        held = null;
        draw();
      },
      cancel: () => {
        held = null;
        if (here()) setPan(ctx, before);
        draw();
      },
    }),
    listen(
      map,
      "wheel",
      (e) => {
        if (e.ctrlKey) return;
        e.preventDefault();
        wheelPan(ctx, e, appSize().vh);
      },
      { passive: false },
    ),
    listen(map, "keydown", (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const { vw, vh } = appSize();
      const next =
        e.key === "Home" ? ORIGIN : panByKey(panOf(ctx.store.get()), e.key, e.shiftKey, vw, vh);
      if (!next) return;
      e.preventDefault();
      setPan(ctx, next);
    }),
    ctx.store.watch(
      (s) => [
        s.desktop,
        s.pan,
        s.mapFolded,
        s.lang,
        s.focused,
        s.adopted,
        windowsOf(s).map((p) => [
          p.id,
          p.x,
          p.y,
          p.w,
          p.h,
          p.floating === true,
          p.fill,
          !!p.restore,
        ]),
      ],
      draw,
    ),
    listen(window, "resize", draw),
  ];
  draw();
  return () => {
    for (const dispose of off) dispose();
    el.remove();
  };
}
