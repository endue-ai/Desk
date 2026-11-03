/** World-space scenery behind the windows, driven by the shell's injected clock. */

import { windowsOf } from "../shell/actions";
import type { ShellCtx } from "../shell/context";
import { h, listen } from "../shell/dom";
import { panOf } from "../shell/Pan";
import { appSize, screenRect } from "../surface/coordinates";

export const WALLPAPER = "desk.wallpaper.scene";
export const SCENES = ["theme", "grid", "pond", "aurora"] as const;
export type Scene = (typeof SCENES)[number];
const LIFETIME = 3200;
const LIMIT = 16;

function pond() {
  const svg = (name: string, attrs: Record<string, string>) => {
    const node = document.createElementNS("http://www.w3.org/2000/svg", name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
  };
  const el = svg("svg", { class: "wallpaper-pond", width: "100%", height: "100%" });
  const defs = svg("defs", {});
  const tile = svg("pattern", {
    id: "desk-pond-tile",
    patternUnits: "userSpaceOnUse",
    width: "1200",
    height: "900",
  });
  for (const [x, y, angle, scale] of [
    [150, 210, -25, 1],
    [1030, 710, 145, 0.8],
  ]) {
    const leaves = svg("g", { transform: `translate(${x} ${y}) rotate(${angle}) scale(${scale})` });
    for (const [dx, dy, size] of [
      [0, 0, 1],
      [70, 34, 0.7],
      [-40, 66, 0.55],
    ]) {
      const leaf = svg("path", {
        d: "M 0 0 L 42 -20 A 48 36 0 1 1 36 -28 Z",
        transform: `translate(${dx} ${dy}) scale(${size})`,
        class: "pond-leaf",
      });
      leaves.append(leaf);
    }
    tile.append(leaves);
  }
  defs.append(tile);
  el.append(defs, svg("rect", { width: "100%", height: "100%", fill: "url(#desk-pond-tile)" }));
  return { el, tile };
}

export function mountWallpaper(root: HTMLElement, ctx: ShellCtx): () => void {
  const scenery = pond();
  const effects = h("div", { class: "wallpaper-effects" });
  const el = h("div", { class: "wallpaper", "aria-hidden": "true" }, scenery.el, effects);
  root.prepend(el);
  let scene: Scene = "theme";
  let desktop = ctx.store.get().desktop;
  let known = new Set(windowsOf(ctx.store.get()).map((p) => p.id));
  const ripples: { el: HTMLElement; at: number; size: number }[] = [];
  let offTick: (() => void) | undefined;
  let disposed = false;
  let lastFrame = -Infinity;
  const clear = () => {
    for (const ripple of ripples.splice(0)) ripple.el.remove();
  };
  const tick = (now: number) => {
    // Wallpaper rendering is capped at 30 fps; no extra animation loop or timers are created.
    if (now - lastFrame < 32) return;
    lastFrame = now;
    el.style.setProperty("--wallpaper-drift", `${(Math.sin(now / 14000) * 70).toFixed(2)}px`);
    el.style.setProperty("--water-light", (0.6 + 0.15 * Math.sin(now / 4000)).toFixed(3));
    for (let i = ripples.length - 1; i >= 0; i--) {
      const ripple = ripples[i];
      if (!ripple) continue;
      const t = Math.min(1, (now - ripple.at) / LIFETIME);
      if (t === 1) {
        ripple.el.remove();
        ripples.splice(i, 1);
      } else {
        ripple.el.style.setProperty("--ripple-size", `${ripple.size + 500 * t}px`);
        ripple.el.style.opacity = String((1 - t) ** 2);
      }
    }
  };
  const animate = () => {
    offTick?.();
    offTick = undefined;
    if (disposed) return;
    const live = scene === "pond" || scene === "aurora";
    const still = ctx.reduced() || root.ownerDocument.hidden;
    el.dataset.motion = still ? "still" : "full";
    if (still) {
      clear();
      el.style.setProperty("--wallpaper-drift", "0px");
      el.style.setProperty("--water-light", "0.6");
    } else if (live) {
      lastFrame = -Infinity;
      offTick = ctx.ticker.add(tick);
    }
  };
  const choose = () => {
    const value = ctx.runtime.settings.get(WALLPAPER, "theme");
    const next = SCENES.includes(value as Scene) ? (value as Scene) : "theme";
    if (next !== scene) clear();
    scene = next;
    el.dataset.scene = scene;
    animate();
  };
  const draw = () => {
    const state = ctx.store.get();
    const pan = panOf(state);
    el.style.setProperty("--wallpaper-x", `${pan.x}px`);
    el.style.setProperty("--wallpaper-y", `${pan.y}px`);
    scenery.tile.setAttribute("patternTransform", `translate(${pan.x} ${pan.y})`);
    const windows = windowsOf(state);
    if (state.desktop !== desktop) {
      desktop = state.desktop;
      clear();
      known = new Set(windows.map((p) => p.id));
    }
    if (scene === "pond" && !ctx.reduced() && !root.ownerDocument.hidden) {
      const { vw, vh } = appSize();
      for (const window of windows) {
        if (known.has(window.id)) continue;
        const rect = screenRect(window, pan, vw, vh);
        const ripple = h("div", { class: "wallpaper-ripple" });
        ripple.style.setProperty("--ripple-x", `${rect.x + rect.w / 2 - pan.x}px`);
        ripple.style.setProperty("--ripple-y", `${rect.y + rect.h / 2 - pan.y}px`);
        const size = Math.max(64, Math.min(1000, Math.hypot(rect.w, rect.h)));
        ripple.style.setProperty("--ripple-size", `${size}px`);
        effects.append(ripple);
        ripples.push({ el: ripple, at: ctx.ticker.now(), size });
        while (ripples.length > LIMIT) ripples.shift()?.el.remove();
      }
    }
    known = new Set(windows.map((p) => p.id));
  };
  const offs = [
    ctx.store.watch((s) => [s.desktop, s.pan, windowsOf(s)], draw),
    ctx.runtime.settings.onChange((keys) => {
      if (keys.includes(WALLPAPER)) choose();
    }),
    ctx.runtime.themes.onChange(animate),
    listen(root.ownerDocument, "visibilitychange", animate),
  ];
  choose();
  draw();
  return () => {
    disposed = true;
    offTick?.();
    for (const off of offs) off();
    clear();
    el.remove();
  };
}
