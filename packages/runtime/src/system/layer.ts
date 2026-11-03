/**
 * The system layer: the desk's own controls, which no mode can move, hide or replace. The mode switcher
 * (top left), desktop switcher (top right), agent bar (left) and personal controls (bottom left) stay
 * above everything a mode lays out. Modes decide the layer below: surfaces, Eris, the rail, the drawer.
 * In safe mode a badge sits top centre (ADR 0061).
 */
import type { ShellCtx } from "../shell/context";
import { mountDesktops } from "../shell/Desktops";
import { h } from "../shell/dom";
import { mountModes } from "../shell/Modes";
import { mountSideBar } from "../shell/SideBar";
import type { StartInfo } from "../start";
import { mountThemeStudio } from "../theme-studio/studio";
import { mountAccountBar } from "./AccountBar";
import { mountSafeBadge } from "./safe-mode";

export function mountSystemLayer(
  root: HTMLElement,
  ctx: ShellCtx,
  safe?: StartInfo["safe"],
): () => void {
  const layer = h("div", { class: "layer layer-system", "data-layer": "system" });
  root.append(layer);
  const parts = [
    mountModes(layer, ctx),
    mountDesktops(layer, ctx),
    mountSideBar(layer, ctx),
    mountAccountBar(layer, ctx),
  ];
  parts.push(mountSafeBadge(layer, ctx, safe));
  // The theme studio is the desk's own window too (ADR 0056); desk.theme.studio opens it.
  const studio = mountThemeStudio(root, {
    themes: ctx.runtime.themes,
    commands: ctx.runtime.commands,
    lang: () => ctx.store.get().lang,
    fallback: () => layer.querySelector<HTMLElement>(".account-settings-button") ?? root,
    io: () => ctx.runtime.themes.io(),
  });
  return () => {
    studio.dispose();
    for (const off of parts) off();
    layer.remove();
  };
}
