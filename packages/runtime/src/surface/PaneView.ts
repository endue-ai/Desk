/**
 * Draw a surface's pane tree: panes side by side or stacked, with a divider between them that drags
 * (or takes arrow keys) to resize. With more than one pane, each gets a slim header and a close button.
 */
import type { PaneNode, PaneSplit, SurfacePlacement } from "../modes/types";
import type { ShellCtx } from "../shell/context";
import { h, listen } from "../shell/dom";
import { draggable } from "../shell/drag";
import { icon } from "../shell/icons";
import { closePane, focusPane, resizeSplit } from "../shell/windows";
import { leaves, MIN_RATIO, panesOf } from "./tree";
import { type Mounted, viewOf } from "./views";

const STEP = 0.05;

export function renderPanes(ctx: ShellCtx, surface: SurfacePlacement): Mounted {
  const offs: (() => void)[] = [];
  const tree = panesOf(surface);
  const many = leaves(tree).length > 1;

  const leafEl = (node: Extract<PaneNode, { kind: "view" }>) => {
    const view = viewOf(ctx, node.view);
    const mounted = view.mount({ surface: surface.id, pane: node.id });
    if (mounted.off) offs.push(mounted.off);
    return h(
      "div",
      {
        class: `pane${view.byEris ? " is-eris" : ""}`,
        "data-pane": node.id,
        "data-view": node.view,
        role: "group",
        "aria-label": view.title,
      },
      many
        ? h(
            "div",
            { class: "pane-head" },
            icon(view.icon, 14),
            h("span", { class: "pane-name" }, view.title),
            h(
              "button",
              {
                class: "icon-button tool pane-close",
                type: "button",
                "aria-label": `${ctx.tr("closePane")} · ${view.title}`,
                title: ctx.tr("closePane"),
                onClick: (e: Event) => {
                  e.stopPropagation();
                  focusPane(ctx, surface.id, node.id);
                  closePane(ctx);
                },
              },
              icon("close", 12),
            ),
          )
        : null,
      h("div", { class: "pane-body" }, mounted.el),
    );
  };

  const splitEl = (node: PaneSplit): HTMLElement => {
    const row = node.dir === "row";
    const a = h(
      "div",
      { class: "split-a", style: { "flex-basis": `${node.ratio * 100}%` } },
      nodeEl(node.a),
    );
    const divider = h("div", {
      class: "divider",
      role: "separator",
      tabindex: "0",
      "data-split": node.id,
      "aria-orientation": row ? "vertical" : "horizontal",
      "aria-valuemin": MIN_RATIO * 100,
      "aria-valuemax": (1 - MIN_RATIO) * 100,
      "aria-valuenow": Math.round(node.ratio * 100),
      "aria-label": ctx.tr(row ? "splitRight" : "splitDown"),
    });
    const el = h(
      "div",
      { class: `split split-${node.dir}` },
      a,
      divider,
      h("div", { class: "split-b" }, nodeEl(node.b)),
    );
    let start = node.ratio;
    let size = 1;
    const ratioAt = (dx: number, dy: number) =>
      Math.min(1 - MIN_RATIO, Math.max(MIN_RATIO, start + (row ? dx : dy) / size));
    offs.push(
      draggable(divider, {
        start: () => {
          const r = el.getBoundingClientRect();
          size = Math.max(1, row ? r.width : r.height);
          start = node.ratio;
        },
        move: (dx, dy) => {
          a.style.flexBasis = `${ratioAt(dx, dy) * 100}%`;
        },
        end: (dx, dy) => resizeSplit(ctx, surface.id, node.id, ratioAt(dx, dy)),
      }),
      listen(divider, "keydown", (e) => {
        const k = e as KeyboardEvent;
        const less = row ? "ArrowLeft" : "ArrowUp";
        const more = row ? "ArrowRight" : "ArrowDown";
        if (k.key !== less && k.key !== more) return;
        k.preventDefault();
        resizeSplit(ctx, surface.id, node.id, node.ratio + (k.key === more ? STEP : -STEP));
      }),
    );
    return el;
  };

  const nodeEl = (node: PaneNode): HTMLElement =>
    node.kind === "view" ? leafEl(node) : splitEl(node);
  const el = h("div", { class: `panes${many ? " is-split" : ""}` }, nodeEl(tree));
  return {
    el,
    off: () => {
      for (const off of offs) off();
    },
  };
}
