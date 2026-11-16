/**
 * The strip under the canvas map at the bottom right (issue 296, design in issue 291, ADR 0253):
 * the name of the desktop in front, the Drawer button with its count, and the way back to the canvas's origin.
 * The compositor draws the map (issue 54, ADR 0161) 64 above the app's bottom; the strip fills the 32
 * under it, as wide (`scale.css`), so the two read as one card. It stays while the map is folded,
 * so both buttons are always reachable, and goes past the right edge with the rail while a window
 * fills the app (`away.ts`). The origin button is there at the origin too, disabled.
 */
import { desktopId, desktopsOf } from "./actions";
import type { ShellCtx } from "./context";
import { mountDrawer } from "./Drawer";
import { h } from "./dom";
import { icon } from "./icons";
import { panOf, setPan } from "./Pan";
import type { DeskState } from "./state";

/** How the desktop in front reads: its own name once it has one, else "Desktop 2". */
export function frontName(ctx: Pick<ShellCtx, "tr">, s: DeskState): string {
  const list = desktopsOf(s);
  const id = desktopId(s);
  const at = list.findIndex((d) => d.id === id);
  const n = at + 1;
  const d = list[at];
  return !d || d.name === String(n) ? ctx.tr("desktop", { n: Math.max(n, 1) }) : d.name;
}

export function mountMapStrip(root: HTMLElement, ctx: ShellCtx): () => void {
  const name = h("span", { class: "map-strip-name" });
  const el = h("div", { class: "map-strip", role: "group" }, name);
  root.append(el);
  const drawer = mountDrawer(el, ctx);
  const reset = h(
    "button",
    {
      class: "canvas-reset icon-button",
      type: "button",
      onClick: () => setPan(ctx, { x: 0, y: 0 }),
    },
    icon("target", 18),
  );
  el.append(reset);

  const draw = () => {
    const s = ctx.store.get();
    el.setAttribute("aria-label", ctx.tr("mapStrip"));
    const named = frontName(ctx, s);
    name.textContent = named;
    name.title = named;
    // At the origin there is nowhere to go back to: disabled, out of the tab order, never gone.
    const pan = panOf(s);
    reset.disabled = !pan.x && !pan.y;
    reset.title = ctx.tr("resetPan");
    reset.setAttribute("aria-label", ctx.tr("resetPan"));
    el.classList.toggle("is-map-folded", s.mapFolded);
  };
  draw();
  const off = ctx.store.watch(
    (s) => [s.pan, s.desktop, s.wm.desktops, s.wm.here, s.lang, s.mapFolded],
    draw,
  );
  return () => {
    off();
    drawer();
    el.remove();
  };
}
