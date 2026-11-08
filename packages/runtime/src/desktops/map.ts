/**
 * A desktop drawn small (ADR 0117): its windows to scale, where they sit on screen at its pan now,
 * so the overview and the switcher's preview show it live. A window can be dragged out of a map onto
 * another desktop.
 */
import type { DesktopId, SurfacePlacement } from "../modes/types";
import { windowsOf } from "../shell/actions";
import type { ShellCtx } from "../shell/context";
import { h } from "../shell/dom";
import { icon } from "../shell/icons";
import type { DeskState } from "../shell/state";
import { appSize, ORIGIN, screenRect } from "../surface/coordinates";
import { leaves, panesOf } from "../surface/tree";
import { resolveView, viewOf } from "../surface/views";

const percent = (n: number) => `${Math.round(n * 10000) / 100}%`;

/** What a window is called in a map: what its title bar names. */
export function windowTitle(ctx: ShellCtx, s: DeskState, p: SurfacePlacement): string {
  const first = leaves(panesOf(p))[0];
  return first ? viewOf(ctx, resolveView(s, p, first.view)).title : p.id;
}

function windowIcon(ctx: ShellCtx, s: DeskState, p: SurfacePlacement): string {
  const first = leaves(panesOf(p))[0];
  return first ? viewOf(ctx, resolveView(s, p, first.view)).icon : "box";
}

export interface MapOptions {
  /** Name the windows (the overview) or only draw them (the switcher's preview). */
  titles?: boolean;
  /** Make each window a drag handle carrying its id (the overview). */
  drag?: boolean;
}

/** One desktop's windows, in a box with the app's proportions. */
export function deskMap(
  ctx: ShellCtx,
  s: DeskState,
  desktop: DesktopId,
  options: MapOptions = {},
): HTMLElement {
  const { vw, vh } = appSize();
  const pan = s.pan[desktop] ?? ORIGIN;
  const windows = windowsOf(s, desktop).map((p) => {
    const r = screenRect(p, pan, vw, vh);
    const x = Math.max(0, Math.min(1, r.x / vw));
    const y = Math.max(0, Math.min(1, r.y / vh));
    const w = Math.max(0, Math.min(1 - x, (r.x + r.w) / vw - x));
    const height = Math.max(0, Math.min(1 - y, (r.y + r.h) / vh - y));
    const title = windowTitle(ctx, s, p);
    const focused = s.focused === p.id || s.focusBy[desktop]?.window === p.id;
    return h(
      "span",
      {
        class: `desk-map-window${focused ? " is-focused" : ""}`,
        "data-window": p.id,
        title,
        draggable: options.drag ? "true" : undefined,
        style: { left: percent(x), top: percent(y), width: percent(w), height: percent(height) },
      },
      options.titles ? [icon(windowIcon(ctx, s, p), 12), h("span", {}, title)] : null,
    );
  });
  return h(
    "span",
    {
      class: "desk-map",
      "aria-hidden": "true",
      style: { "aspect-ratio": `${vw} / ${vh}` },
    },
    windows,
  );
}
