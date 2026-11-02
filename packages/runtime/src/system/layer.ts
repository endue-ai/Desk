/**
 * The system layer: the desk's own controls, which no mode can move, hide or replace. The mode switcher
 * (top left), the desktop switcher (top right) and the agent bar (left) sit here at fixed places,
 * above everything a mode lays out. Modes decide the layer below: surfaces, Eris, the rail, the drawer.
 */
import type { ShellCtx } from "../shell/context";
import { mountDesktops } from "../shell/Desktops";
import { h } from "../shell/dom";
import { mountModes } from "../shell/Modes";
import { mountSideBar } from "../shell/SideBar";
import { mountThemeStudio } from "../theme-studio/studio";

export function mountSystemLayer(root: HTMLElement, ctx: ShellCtx): () => void {
  const layer = h("div", { class: "layer layer-system", "data-layer": "system" });
  root.append(layer);
  const parts = [mountModes(layer, ctx), mountDesktops(layer, ctx), mountSideBar(layer, ctx)];
  // The theme studio is the desk's own window too (ADR 0056); desk.theme.studio opens it.
  const studio = mountThemeStudio(root, {
    themes: ctx.runtime.themes,
    commands: ctx.runtime.commands,
    lang: () => ctx.store.get().lang,
    fallback: () => root,
    io: () => ctx.runtime.themes.io(),
  });
  return () => {
    studio.dispose();
    for (const off of parts) off();
    layer.remove();
  };
}
