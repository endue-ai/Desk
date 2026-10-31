/**
 * Surfaces: windows on the desk. Card face, 1 px border, no shadow; Eris's own carry the lavender
 * border and a badge. Drag the title bar to move, the corner to resize; both save to the session layout.
 */

import type { SurfacePlacement } from "../modes/types";
import { closeSurface, layoutOf, moveSurface, stash, togglePin } from "../shell/actions";
import type { ShellCtx } from "../shell/context";
import { h, listen, render } from "../shell/dom";
import { draggable } from "../shell/drag";
import { icon } from "../shell/icons";
import { focusPane, splitPane } from "../shell/windows";
import { clampRect, fromScreen, type Rect, toScreen } from "./geometry";
import { renderPanes } from "./PaneView";
import { findLeaf, leaves, panesOf } from "./tree";
import { type Mounted, viewOf } from "./views";

/** The pane whose view the title bar names: the focused one, else the first. */
function activeLeaf(ctx: ShellCtx, p: SurfacePlacement) {
  const s = ctx.store.get();
  const tree = panesOf(p);
  return (s.focused === p.id && s.pane ? findLeaf(tree, s.pane) : undefined) ?? leaves(tree)[0];
}

function tool(label: string, name: string, run: () => void, pressed?: boolean) {
  return h(
    "button",
    {
      class: "icon-button tool",
      type: "button",
      "aria-label": label,
      title: label,
      "aria-pressed": pressed === undefined ? undefined : String(pressed),
      onClick: (e: Event) => {
        e.stopPropagation();
        run();
      },
    },
    icon(name, 14),
  );
}

interface Entry {
  el: HTMLElement;
  title: HTMLElement;
  body: HTMLElement;
  /** Rebuild the whole surface when this changes (pinned, language). */
  key: string;
  /** Rebuild only the panes when this changes. */
  panesKey: string;
  panes: Mounted;
  /** Refresh the key hints in the tools' labels (the keymap changed). */
  relabel: () => void;
  off: () => void;
}

export function mountSurfaces(root: HTMLElement, ctx: ShellCtx): () => void {
  const layer = h("div", { class: "surfaces" });
  root.append(layer);
  const live = new Map<string, Entry>();
  const size = () => ({
    vw: root.clientWidth || window.innerWidth,
    vh: root.clientHeight || window.innerHeight,
  });
  const hint = (label: string, command: string) => {
    const key = ctx.keyOf(command);
    return key ? `${label} (${key})` : label;
  };

  const place = (el: HTMLElement, r: Rect) => {
    el.style.left = `${r.x}px`;
    el.style.top = `${r.y}px`;
    el.style.width = `${r.w}px`;
    el.style.height = `${r.h}px`;
  };

  /** Title bar text for the active pane: icon, name, the view's own line and Eris's badge. */
  const drawTitle = (entry: Entry, p: SurfacePlacement) => {
    const leaf = activeLeaf(ctx, p);
    const view = viewOf(ctx, leaf?.view ?? p.id);
    render(entry.title, () => [
      icon(view.icon, 16),
      h("span", { class: "surface-name" }, view.title),
      view.sub ? h("span", { class: "surface-sub" }, view.sub) : null,
      view.byEris ? h("span", { class: "eris-badge" }, ctx.tr("madeByEris")) : null,
    ]);
    entry.el.setAttribute("aria-label", view.title);
  };

  const build = (p: SurfacePlacement): Entry => {
    const title = h("span", { class: "surface-heading" });
    const split = (dir: "row" | "column") => () => {
      focusPane(ctx, p.id, activeLeaf(ctx, p)?.id);
      splitPane(ctx, dir);
    };
    const splitRight = tool(
      hint(ctx.tr("splitRight"), "desk.display.split-right"),
      "split-right",
      split("row"),
    );
    const splitDown = tool(
      hint(ctx.tr("splitDown"), "desk.display.split-down"),
      "split-down",
      split("column"),
    );
    const relabel = () => {
      for (const [button, label, command] of [
        [splitRight, ctx.tr("splitRight"), "desk.display.split-right"],
        [splitDown, ctx.tr("splitDown"), "desk.display.split-down"],
      ] as const) {
        button.setAttribute("aria-label", hint(label, command));
        button.title = hint(label, command);
      }
    };
    const bar = h(
      "header",
      { class: "surface-title" },
      title,
      h(
        "span",
        { class: "surface-tools" },
        splitRight,
        splitDown,
        tool(ctx.tr(p.pinned ? "unpin" : "pin"), "pin", () => togglePin(ctx, p.id), p.pinned),
        tool(ctx.tr("stash"), "drawer", () =>
          stash(ctx, p.id, viewOf(ctx, activeLeaf(ctx, p)?.view ?? p.id).title),
        ),
        tool(ctx.tr("close"), "close", () => closeSurface(ctx, p.id)),
      ),
    );
    const body = h("div", { class: "surface-body" });
    const grip = h("span", {
      class: "surface-resize",
      "aria-hidden": "true",
      title: ctx.tr("resize"),
    });
    const el = h(
      "section",
      {
        class: `surface${p.pinned ? " is-pinned" : ""}`,
        "data-surface": p.id,
        role: "region",
        tabindex: "-1",
      },
      bar,
      body,
      grip,
    );
    let start: Rect = { x: 0, y: 0, w: 0, h: 0 };
    const begin = () => {
      start = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
      el.classList.add("is-dragging");
    };
    const commit = (r: Rect) => {
      el.classList.remove("is-dragging");
      const { vw, vh } = size();
      moveSurface(ctx, p.id, fromScreen(r, vw, vh));
    };
    /** Focus follows the pointer or keyboard into a pane. */
    const focusFrom = (target: EventTarget | null) => {
      const pane = (target as Element | null)?.closest?.("[data-pane]")?.getAttribute("data-pane");
      const s = ctx.store.get();
      focusPane(ctx, p.id, pane ?? (s.focused === p.id ? (s.pane ?? undefined) : undefined));
    };
    const offs = [
      listen(el, "pointerdown", (e) => focusFrom(e.target)),
      listen(el, "focusin", (e) => focusFrom(e.target)),
      draggable(bar, {
        accept: (e) => !(e.target as Element).closest("button") && !p.pinned,
        start: begin,
        move: (dx, dy) => {
          const { vw, vh } = size();
          place(el, clampRect({ ...start, x: start.x + dx, y: start.y + dy }, vw, vh));
        },
        end: (dx, dy) => {
          const { vw, vh } = size();
          commit(clampRect({ ...start, x: start.x + dx, y: start.y + dy }, vw, vh));
        },
      }),
      draggable(grip, {
        start: begin,
        move: (dx, dy) => {
          const { vw, vh } = size();
          place(el, clampRect({ ...start, w: start.w + dx, h: start.h + dy }, vw, vh));
        },
        end: (dx, dy) => {
          const { vw, vh } = size();
          commit(clampRect({ ...start, w: start.w + dx, h: start.h + dy }, vw, vh));
        },
      }),
    ];
    const entry: Entry = {
      el,
      title,
      body,
      key: "",
      panesKey: "",
      panes: { el: body },
      relabel,
      off: () => {
        for (const off of offs) off();
        entry.panes.off?.();
      },
    };
    return entry;
  };

  const draw = () => {
    const s = ctx.store.get();
    const { vw, vh } = size();
    const surfaces = layoutOf(s).surfaces;
    const keep = new Set(surfaces.map((p) => p.id));
    for (const [id, entry] of live) {
      if (keep.has(id)) continue;
      entry.off();
      entry.el.remove();
      live.delete(id);
    }
    surfaces.forEach((p, i) => {
      const key = JSON.stringify([p.pinned, s.lang]);
      let entry = live.get(p.id);
      if (entry && entry.key !== key) {
        entry.off();
        entry.el.remove();
        entry = undefined;
      }
      if (!entry) {
        entry = build(p);
        entry.key = key;
        live.set(p.id, entry);
        layer.append(entry.el);
      }
      const panesKey = JSON.stringify(panesOf(p));
      if (entry.panesKey !== panesKey) {
        entry.panes.off?.();
        entry.panes = renderPanes(ctx, p);
        entry.body.replaceChildren(entry.panes.el);
        entry.panesKey = panesKey;
      }
      const all = leaves(panesOf(p));
      const active = s.focused === p.id ? activeLeaf(ctx, p)?.id : undefined;
      for (const pane of entry.body.querySelectorAll<HTMLElement>("[data-pane]")) {
        pane.classList.toggle("is-active", pane.dataset.pane === active && all.length > 1);
      }
      entry.el.classList.toggle(
        "is-eris",
        all.every((l) => viewOf(ctx, l.view).byEris),
      );
      drawTitle(entry, p);
      place(entry.el, toScreen(p, vw, vh));
      entry.el.style.zIndex = String(p.id === s.focused ? 100 : p.pinned ? 50 + i : 1 + i);
      entry.el.classList.toggle("is-focused", p.id === s.focused);
    });
  };
  draw();
  const offs = [
    ctx.store.watch(
      (s) => [layoutOf(s), s.focused, s.pane, s.lang, s.desktop, s.agents, s.tasks, s.drawer],
      draw,
    ),
    // A new key only changes the tools' hints; rebuilding would remount every view.
    ctx.runtime.keymap.onChange(() => {
      for (const entry of live.values()) entry.relabel();
    }),
    listen(window, "resize", draw),
  ];
  return () => {
    for (const off of offs) off();
    for (const entry of live.values()) entry.off();
    layer.remove();
  };
}
